import { User, WebhookData, ValidationError, UserStats, AdminStats, AdminStatsFilters, PostStats, ReadingHistory } from '../types';

export interface Database {
	prepare: (query: string) => D1PreparedStatement;
	run: (query: string, params?: any[]) => Promise<D1Result>;
	all: (query: string, params?: any[]) => Promise<D1Result>;
	exec: (query: string) => Promise<D1Result[]>;
}

export class DbService {
	constructor(private db: D1Database) {}

	async createUser(username: string) {
		return this.db.prepare('INSERT INTO users (username) VALUES (?)').bind(username).run();
	}

	async recordReading(userId: number, pagesRead: number, readDate: string) {
		return this.db
			.prepare('INSERT INTO reading_stats (user_id, pages_read, read_date) VALUES (?, ?, ?)')
			.bind(userId, pagesRead, readDate)
			.run();
	}

	async getUserStats(userId: number) {
		return this.db.prepare('SELECT * FROM reading_stats WHERE user_id = ? ORDER BY read_date DESC').bind(userId).all();
	}

	async recordRead(data: WebhookData) {
		return this.db.prepare(`INSERT INTO reads (email, post_id) VALUES (?, ?)`).bind(data.email, data.post_id).run();
	}
}

export class DatabaseService {
	private db: D1Database;

	constructor(db: D1Database) {
		this.db = db;
	}

	prepare(query: string) {
		return this.db.prepare(query);
	}

	async getOrCreateUser(email: string): Promise<User> {
		let user = await this.db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();

		if (!user) {
			// Create new user with NULL password_hash
			await this.db
				.prepare('INSERT INTO users (email, current_streak, highest_streak, password_hash) VALUES (?, 1, 1, NULL)')
				.bind(email)
				.run();
			user = await this.db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
		}

		return user!;
	}

	async getLastReadDate(userId: number): Promise<string | null> {
		const result = await this.db
			.prepare('SELECT read_date FROM reading_stats WHERE user_id = ? ORDER BY read_date DESC LIMIT 1')
			.bind(userId)
			.first<{ read_date: string }>();

		return result?.read_date || null;
	}

	async updateUserStreak(userId: number, newStreak: number): Promise<void> {
		await this.db
			.prepare(
				`
				UPDATE users 
				SET current_streak = ?,
					highest_streak = CASE 
						WHEN ? > highest_streak THEN ? 
						ELSE highest_streak 
					END,
					last_read_date = DATE('now')
				WHERE id = ?
				`
			)
			.bind(newStreak, newStreak, newStreak, userId)
			.run();
	}

	async getLastUniquePostRead(userId: number): Promise<{ post_id: string; read_date: string } | null> {
		const result = await this.db
			.prepare(
				`
				SELECT post_id, read_date 
				FROM reading_stats 
				WHERE user_id = ? 
				ORDER BY id DESC LIMIT 1
			`
			)
			.bind(userId)
			.first<{ post_id: string; read_date: string }>();

		return result || null;
	}

	async hasReadPost(userId: number, postId: string): Promise<boolean> {
		const result = await this.db
			.prepare('SELECT 1 FROM reading_stats WHERE user_id = ? AND post_id = ? LIMIT 1')
			.bind(userId, postId)
			.first<{ 1: number }>();

		return !!result;
	}

	async recordRead(data: WebhookData): Promise<void> {
		const user = await this.getOrCreateUser(data.email);

		// Check if user has already read this post
		const hasRead = await this.hasReadPost(user.id, data.post_id);
		if (hasRead) {
			return;
		}

		// Record the new read
		await this.db
			.prepare(
				`
				INSERT INTO reading_stats (
					user_id, post_id, utm_source, utm_medium, 
					utm_campaign, utm_channel, read_date
				) VALUES (?, ?, ?, ?, ?, ?, DATE('now', 'localtime'))
			`
			)
			.bind(user.id, data.post_id, data.utm_source || null, data.utm_medium || null, data.utm_campaign || null, data.utm_channel || null)
			.run();

		// Get the last read date before this one
		const lastRead = await this.db
			.prepare(
				`SELECT DISTINCT date(read_date, 'localtime') as read_date 
				FROM reading_stats 
				WHERE user_id = ? 
					AND date(read_date, 'localtime') <= date('now', 'localtime')
				ORDER BY read_date DESC LIMIT 2` // Pegamos os últimos 2 dias de leitura
			)
			.bind(user.id)
			.all();

		const lastReads = (lastRead?.results || []) as { read_date: string }[];
		const today = new Date();
		const todayStr = today.toISOString().split('T')[0];

		let newStreak = 1; // Default to 1 for first read

		if (lastReads.length > 0) {
			// Se temos leituras anteriores
			if (lastReads[0].read_date === todayStr) {
				// Se já leu hoje, mantém o streak atual
				newStreak = user.current_streak;
			} else if (lastReads.length > 1) {
				// Se temos pelo menos 2 dias de leitura
				const lastReadDate = new Date(lastReads[0].read_date);
				const prevReadDate = new Date(lastReads[1].read_date);

				// Verifica se são dias consecutivos (excluindo domingo)
				const daysDiff = Math.floor((lastReadDate.getTime() - prevReadDate.getTime()) / (1000 * 60 * 60 * 24));
				const isConsecutive = daysDiff === 1 || (daysDiff === 2 && prevReadDate.getDay() === 5 && lastReadDate.getDay() === 1);

				if (isConsecutive) {
					// Se são dias consecutivos, incrementa o streak
					newStreak = user.current_streak + 1;
				}
			}
		}

		// Update the user's streak
		await this.db
			.prepare(
				`
				UPDATE users 
				SET current_streak = ?,
					highest_streak = CASE 
						WHEN ? > highest_streak THEN ?
						ELSE highest_streak 
					END,
					last_read_date = DATE('now', 'localtime')
				WHERE id = ?
				`
			)
			.bind(newStreak, newStreak, newStreak, user.id)
			.run();
	}

	async getUserStats(userId?: number, email?: string): Promise<UserStats> {
		const query = `
			WITH RECURSIVE dates(date) AS (
				-- Começa com a data atual no timezone do Brasil (UTC-3)
				SELECT date(datetime('now', '-3 hours'), 'localtime')
				UNION ALL
				SELECT date(date, '-1 day')
				FROM dates
				WHERE date >= date(datetime('now', '-3 hours'), '-90 days', 'localtime')
			),
			user_base AS (
				SELECT * FROM users WHERE ${userId ? 'id = ?' : 'email = ?'}
			),
			daily_reads AS (
				-- Pega apenas uma leitura por dia por usuário, considerando timezone BR
				SELECT DISTINCT 
					date(datetime(read_date, '-3 hours'), 'localtime') as read_date
				FROM reading_stats r
				JOIN user_base u ON r.user_id = u.id
				ORDER BY read_date DESC
			),
			streak_days AS (
				SELECT 
					d.date,
					CASE 
						WHEN EXISTS (
							SELECT 1 
							FROM daily_reads 
							WHERE read_date = d.date
						) THEN 1
						ELSE 0
					END as has_read,
					CASE 
						WHEN strftime('%w', d.date) = '0' THEN 1  -- é domingo
						ELSE 0 
					END as is_sunday,
					-- Marca se o dia já acabou no timezone BR
					CASE
						WHEN d.date < date(datetime('now', '-3 hours'), 'localtime') THEN 1
						ELSE 0
					END as day_ended
				FROM dates d
				WHERE d.date <= date(datetime('now', '-3 hours'), 'localtime')
				ORDER BY d.date DESC
			),
			streak_calc AS (
				SELECT 
					date,
					has_read,
					is_sunday,
					day_ended,
					ROW_NUMBER() OVER (ORDER BY date DESC) as day_number,
					CASE
						-- Só quebra o streak se:
						-- 1. Não é domingo E
						-- 2. Não tem leitura E
						-- 3. O dia já acabou no timezone BR
						WHEN NOT has_read AND NOT is_sunday AND day_ended = 1 THEN 1
						ELSE 0
					END as breaks_streak
				FROM streak_days
			),
			current_streak AS (
				SELECT COALESCE(
					(
						SELECT COUNT(*)
						FROM streak_calc
						WHERE day_number <= (
							-- Pega todos os dias até a primeira quebra de streak
							SELECT MIN(day_number) - 1
							FROM streak_calc
							WHERE breaks_streak = 1
						)
						AND (has_read = 1 OR is_sunday = 1)  -- Conta dias com leitura ou domingos
					),
					CASE 
						WHEN EXISTS (
							SELECT 1 
							FROM streak_calc 
							WHERE day_number = 1 
							AND has_read = 1
						) THEN 1  -- Se leu hoje, mínimo é 1
						ELSE 0    -- Se não leu hoje, é 0
					END
				) as streak_count
			),
			user_data AS (
				SELECT 
					u.id,
					u.highest_streak,
					u.last_read_date,
					u.created_at,
					COUNT(DISTINCT r.id) as total_reads,
					GROUP_CONCAT(DISTINCT r.utm_source) as sources,
					(
						SELECT COUNT(*)
						FROM (
							WITH RECURSIVE dates(date) AS (
								SELECT date(u.created_at)
								UNION ALL
								SELECT date(date, '+1 day')
								FROM dates
								WHERE date < date(datetime('now', '-3 hours'), 'localtime')
							)
							SELECT date
							FROM dates
							WHERE strftime('%w', date) != '0'  -- Exclude Sundays
						)
					) as total_possible_newsletters,
					(SELECT streak_count FROM current_streak) as current_streak
				FROM user_base u
				LEFT JOIN reading_stats r ON u.id = r.user_id
				GROUP BY u.id
			)
			SELECT 
				current_streak,
				CASE
					WHEN current_streak > highest_streak THEN current_streak
					ELSE highest_streak
				END as highest_streak,
				COALESCE(total_reads, 0) as total_reads,
				last_read_date,
				sources,
				CASE 
					WHEN total_possible_newsletters > 0 THEN
						MIN(
							ROUND((CAST(total_reads AS FLOAT) / total_possible_newsletters) * 100, 2),
							100
						)
					ELSE 100
				END as opening_rate
			FROM user_data
		`;

		const stats = await this.db
			.prepare(query)
			.bind(userId || email)
			.first<UserStats>();

		return (
			stats || {
				current_streak: 0,
				highest_streak: 0,
				total_reads: 0,
				last_read_date: null,
				sources: [],
				opening_rate: 0,
				history: [],
			}
		);
	}

	async getUserReadingHistory(userId?: number, email?: string): Promise<ReadingHistory[]> {
		const query = `
			SELECT 
				r.read_date as date,
				r.post_id
			FROM reading_stats r
			JOIN users u ON r.user_id = u.id
			WHERE ${userId ? 'u.id = ?' : 'u.email = ?'}
			ORDER BY r.read_date DESC
		`;

		const result = await this.db
			.prepare(query)
			.bind(userId || email)
			.all();
		return (result?.results as ReadingHistory[]) || [];
	}

	async getPostStats(postId: string): Promise<PostStats> {
		const basicStats = await this.db
			.prepare(
				`
				SELECT 
					COUNT(*) as total_reads,
					COUNT(DISTINCT user_id) as unique_readers
				FROM reading_stats
				WHERE post_id = ?
			`
			)
			.bind(postId)
			.first<{ total_reads: number; unique_readers: number }>();

		const utmBreakdown = await this.db
			.prepare(
				`
				SELECT 
					utm_source, utm_medium, utm_campaign, utm_channel,
					COUNT(*) as count
				FROM reading_stats
				WHERE post_id = ?
				GROUP BY utm_source, utm_medium, utm_campaign, utm_channel
			`
			)
			.bind(postId)
			.all();

		const breakdown: PostStats['utm_breakdown'] = {
			source: {},
			medium: {},
			campaign: {},
			channel: {},
		};

		(
			utmBreakdown.results as Array<{
				utm_source?: string;
				utm_medium?: string;
				utm_campaign?: string;
				utm_channel?: string;
				count: number;
			}>
		).forEach((row) => {
			if (row.utm_source) breakdown.source[row.utm_source] = row.count;
			if (row.utm_medium) breakdown.medium[row.utm_medium] = row.count;
			if (row.utm_campaign) breakdown.campaign[row.utm_campaign] = row.count;
			if (row.utm_channel) breakdown.channel[row.utm_channel] = row.count;
		});

		return {
			total_reads: basicStats?.total_reads || 0,
			unique_readers: basicStats?.unique_readers || 0,
			utm_breakdown: breakdown,
		};
	}

	private calculateDateRange(filters?: AdminStatsFilters): { startDate: string; endDate: string } {
		const endDate = new Date();
		const startDate = new Date();

		// Se não houver filtros ou período especificado, usa 7 dias como padrão
		const period = filters?.period || '7d';

		switch (period) {
			case '90d':
				startDate.setDate(endDate.getDate() - 90);
				break;
			case '30d':
				startDate.setDate(endDate.getDate() - 30);
				break;
			case '7d':
			default:
				startDate.setDate(endDate.getDate() - 7);
				break;
		}

		return {
			startDate: startDate.toISOString().split('T')[0],
			endDate: endDate.toISOString().split('T')[0],
		};
	}

	async getAdminStats(filters?: AdminStatsFilters): Promise<AdminStats> {
		const dateRange = this.calculateDateRange(filters);
		const params: any[] = [dateRange.startDate, dateRange.endDate];

		const query = `
			WITH user_stats AS (
				SELECT 
					u.id,
					u.current_streak,
					COUNT(r.id) as total_reads,
					(
						SELECT COUNT(*)
						FROM (
							WITH RECURSIVE dates(date) AS (
								SELECT date(u.created_at)
								UNION ALL
								SELECT date(date, '+1 day')
								FROM dates
								WHERE date < date('now')
							)
							SELECT date
							FROM dates
							WHERE strftime('%w', date) != '0'  -- Exclude Sundays
						)
					) as total_possible_newsletters,
					CASE 
						WHEN COUNT(r.id) > 0 THEN 1
						ELSE 0
					END as is_active
				FROM users u
				LEFT JOIN reading_stats r ON u.id = r.user_id 
					AND date(r.read_date) >= date(?)
					AND date(r.read_date) <= date(?)
				WHERE u.email != 'admin@example.com'
				GROUP BY u.id
			),
			user_rates AS (
				SELECT 
					*,
					CASE 
						WHEN total_possible_newsletters > 0 THEN
							MIN(
								ROUND((CAST(total_reads AS FLOAT) / total_possible_newsletters) * 100, 2),
								100
							)
						ELSE 100
					END as opening_rate
				FROM user_stats
			)
			SELECT 
				COUNT(*) as total_users,
				ROUND(AVG(current_streak), 2) as avg_streak,
				ROUND(AVG(opening_rate), 2) as avg_opening_rate,
				SUM(is_active) as active_users
			FROM user_rates
			WHERE opening_rate > 0
		`;

		const result = await this.db
			.prepare(query)
			.bind(...params)
			.first<{
				total_users: number;
				avg_streak: number;
				avg_opening_rate: number;
				active_users: number;
			}>();

		return (
			result || {
				total_users: 0,
				avg_streak: 0,
				avg_opening_rate: 0,
				active_users_30d: 0,
				top_readers: [],
			}
		);
	}

	async getTopReaders(filters?: AdminStatsFilters): Promise<AdminStats['top_readers']> {
		const dateRange = this.calculateDateRange(filters);
		const params: any[] = [dateRange.startDate, dateRange.endDate];

		const query = `
			WITH user_stats AS (
				SELECT 
					u.id,
					u.email,
					u.current_streak,
					u.last_read_date,
					COUNT(r.id) as total_reads,
					(
						SELECT COUNT(*)
						FROM (
							WITH RECURSIVE dates(date) AS (
								SELECT date(u.created_at)
								UNION ALL
								SELECT date(date, '+1 day')
								FROM dates
								WHERE date < date('now')
							)
							SELECT date
							FROM dates
							WHERE strftime('%w', date) != '0'  -- Exclude Sundays
						)
					) as total_possible_newsletters
				FROM users u
				LEFT JOIN reading_stats r ON u.id = r.user_id 
					AND date(r.read_date) >= date(?)
					AND date(r.read_date) <= date(?)
				WHERE u.email != 'admin@example.com'
				GROUP BY u.id
			)
			SELECT 
				email,
				current_streak as streak,
				last_read_date as last_read,
				CASE 
					WHEN total_possible_newsletters > 0 THEN
						MIN(
							ROUND((CAST(total_reads AS FLOAT) / total_possible_newsletters) * 100, 2),
							100
						)
					ELSE 100
				END as opening_rate
			FROM user_stats
			WHERE total_reads > 0
			ORDER BY opening_rate DESC, streak DESC
			LIMIT 10
		`;

		const result = await this.db
			.prepare(query)
			.bind(...params)
			.all();

		return (result?.results as AdminStats['top_readers']) || [];
	}

	async getHistoricalStats(filters?: AdminStatsFilters): Promise<HistoricalStats> {
		const dateRange = this.calculateDateRange(filters);
		const params: any[] = [dateRange.startDate, dateRange.endDate];

		const query = `
			WITH RECURSIVE dates(date) AS (
				SELECT date(?, 'localtime')
				UNION ALL
				SELECT date(date, '+1 day')
				FROM dates
				WHERE date < date(?, 'localtime')
			),
			daily_users AS (
				-- Total de usuários registrados até cada data (excluindo admin)
				SELECT 
					d.date,
					COUNT(DISTINCT u.id) as total_users
				FROM dates d
				LEFT JOIN users u ON date(u.created_at, 'localtime') <= d.date
				WHERE u.email != 'admin@example.com'
				GROUP BY d.date
			),
			daily_reads AS (
				-- Leitores únicos por dia (excluindo admin e domingos)
				SELECT 
					d.date,
					COUNT(DISTINCT r.user_id) as unique_readers,
					CASE
						WHEN COUNT(DISTINCT r.user_id) > 0 THEN ROUND(AVG(DISTINCT u.current_streak), 2)
						ELSE 0
					END as avg_streak
				FROM dates d
				LEFT JOIN users u ON u.email != 'admin@example.com'
				LEFT JOIN (
					-- Garantir apenas uma leitura por usuário por dia
					SELECT DISTINCT 
						user_id,
						date(read_date, 'localtime') as read_date
					FROM reading_stats
				) r ON r.read_date = d.date AND r.user_id = u.id
				WHERE strftime('%w', d.date) != '0'  -- Exclui domingos
				GROUP BY d.date
			)
			SELECT 
				d.date,
				dr.avg_streak,
				CASE 
					WHEN du.total_users > 0 THEN
						ROUND((CAST(COALESCE(dr.unique_readers, 0) AS FLOAT) / du.total_users) * 100, 2)
					ELSE 0
				END as opening_rate
			FROM dates d
			LEFT JOIN daily_users du ON d.date = du.date
			LEFT JOIN daily_reads dr ON d.date = dr.date
			ORDER BY d.date ASC`;

		const result = await this.db
			.prepare(query)
			.bind(...params)
			.all();

		return {
			daily_stats: (result?.results || []).map((row) => ({
				date: row.date,
				avg_streak: row.avg_streak,
				opening_rate: row.opening_rate,
			})),
		};
	}
}

export function errorHandler(error: Error): Response {
	console.error('Error:', error);

	if (error instanceof ValidationError) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
		status: 500,
		headers: { 'Content-Type': 'application/json' },
	});
}

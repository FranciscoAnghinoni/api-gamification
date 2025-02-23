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

	private isValidEmail(email: string): boolean {
		// Regex para validar email
		const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
		return emailRegex.test(email);
	}

	async getOrCreateUser(email: string): Promise<User> {
		if (!this.isValidEmail(email)) {
			throw new ValidationError(`Invalid email address: "${email}". Email must be in a valid format (e.g., user@domain.com)`);
		}

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
		if (!this.isValidEmail(data.email)) {
			throw new ValidationError(`Invalid email address: "${data.email}". Email must be in a valid format (e.g., user@domain.com)`);
		}

		// Verifica se é domingo
		const now = new Date();
		now.setHours(now.getHours() - 3); // Ajusta para UTC-3
		if (now.getDay() === 0) {
			throw new ValidationError(`Reading is not allowed on Sundays`);
		}

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
				) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-3 hours'))
			`
			)
			.bind(user.id, data.post_id, data.utm_source || null, data.utm_medium || null, data.utm_campaign || null, data.utm_channel || null)
			.run();

		// Get distinct read dates ordered by date
		const readDates = await this.db
			.prepare(
				`
				SELECT DISTINCT date(read_date) as read_date
				FROM reading_stats
				WHERE user_id = ?
				ORDER BY read_date DESC
				`
			)
			.bind(user.id)
			.all();

		const dates = (readDates?.results || []) as { read_date: string }[];
		let streak = 0;
		const today = new Date();
		today.setHours(today.getHours() - 3); // Ajusta para UTC-3
		const todayStr = today.toISOString().split('T')[0];

		// Calcula o streak
		for (let i = 0; i < dates.length; i++) {
			const currentDate = new Date(dates[i].read_date);

			// Se é o primeiro dia ou se é consecutivo ao anterior
			if (i === 0) {
				streak = 1;
			} else {
				const prevDate = new Date(dates[i - 1].read_date);
				const diffDays = Math.floor((prevDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

				// Considera consecutivo se for 1 dia de diferença ou se o dia pulado for domingo
				if (diffDays === 1 || (diffDays === 2 && currentDate.getDay() === 0)) {
					streak++;
				} else {
					break;
				}
			}
		}

		// Update user streak
		await this.db
			.prepare(
				`
				UPDATE users 
				SET current_streak = ?,
					highest_streak = CASE 
						WHEN ? > highest_streak THEN ?
						ELSE highest_streak 
					END,
					last_read_date = datetime('now', '-3 hours')
				WHERE id = ?
				`
			)
			.bind(streak, streak, streak, user.id)
			.run();
	}

	async getUserStats(userId?: number, email?: string): Promise<UserStats> {
		const query = `
			WITH RECURSIVE dates(date) AS (
				SELECT date(datetime('now', '-3 hours'))
				UNION ALL
				SELECT date(date, '-1 day')
				FROM dates
				WHERE date >= date(datetime('now', '-3 hours'), '-90 days')
			),
			user_base AS (
				SELECT * FROM users WHERE ${userId ? 'id = ?' : 'email = ?'}
			),
			daily_reads AS (
				SELECT DISTINCT date(read_date) as read_date
				FROM reading_stats r
				JOIN user_base u ON r.user_id = u.id
				ORDER BY read_date DESC
			),
			streak_calc AS (
				SELECT 
					d.date,
					EXISTS (
						SELECT 1 
						FROM daily_reads 
						WHERE read_date = d.date
					) as has_read,
					CASE WHEN strftime('%w', d.date) = '0' THEN 1 ELSE 0 END as is_sunday
				FROM dates d
				WHERE d.date <= date(datetime('now', '-3 hours'))
				ORDER BY d.date DESC
			),
			streak_count AS (
				WITH consecutive_reads AS (
					SELECT 
						date,
						has_read,
						is_sunday,
						ROW_NUMBER() OVER (ORDER BY date DESC) as rn,
						(
							SELECT COUNT(*)
							FROM streak_calc s2
							WHERE s2.date > streak_calc.date
							AND s2.date < date(datetime('now', '-3 hours'))
							AND s2.has_read = 0
							AND s2.is_sunday = 0
						) as gaps_before_today
					FROM streak_calc
					WHERE has_read = 1 
					OR (
						is_sunday = 1 
						AND EXISTS (
							SELECT 1 
							FROM streak_calc s2 
							WHERE s2.date > streak_calc.date 
							AND s2.has_read = 1
							AND s2.date <= date(datetime('now', '-3 hours'))
						)
					)
				)
				SELECT COUNT(*) as current_streak
				FROM consecutive_reads
				WHERE gaps_before_today = 0
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
								WHERE date < date(datetime('now', '-3 hours'))
							)
							SELECT date
							FROM dates
							WHERE strftime('%w', date) != '0'  -- Exclude Sundays
						)
					) as total_possible_newsletters,
					COALESCE((SELECT current_streak FROM streak_count), 0) as current_streak
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
			FROM user_data`;

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
		// Create dates in Brazil's timezone (UTC-3)
		const endDate = new Date();
		endDate.setHours(endDate.getHours() - 3); // Adjust to Brazil timezone

		const startDate = new Date(endDate);

		// Se não houver filtros ou período especificado, usa 7 dias como padrão
		const period = filters?.period || '7d';

		switch (period) {
			case '90d':
				startDate.setDate(endDate.getDate() - 89); // 90 days including today
				break;
			case '30d':
				startDate.setDate(endDate.getDate() - 29); // 30 days including today
				break;
			case '7d':
			default:
				startDate.setDate(endDate.getDate() - 6); // 7 days including today
				break;
		}

		return {
			startDate: startDate.toISOString().split('T')[0],
			endDate: endDate.toISOString().split('T')[0],
		};
	}

	async getAdminStats(filters: AdminStatsFilters): Promise<AdminStats> {
		const { startDate, endDate } = filters;
		const baseParams = [startDate, endDate];
		const params: any[] = [...baseParams, ...baseParams, ...baseParams, ...baseParams];
		let additionalWhere = '';

		if (filters.newsletterDate) {
			additionalWhere += ' AND date(r.read_date, "localtime") = ?';
			params.push(filters.newsletterDate);
		}

		if (filters.minStreak) {
			additionalWhere += ' AND u.current_streak >= ?';
			params.push(filters.minStreak);
		}

		const query = `
			WITH RECURSIVE dates(date) AS (
				SELECT date(?, 'localtime')
				UNION ALL
				SELECT date(date, '+1 day')
				FROM dates
				WHERE date < date(?, 'localtime')
			),
			newsletter_days AS (
				SELECT DISTINCT date(read_date, 'localtime') as date
				FROM reading_stats r
				WHERE date(r.read_date, "localtime") >= date(?)
				AND date(r.read_date, "localtime") <= date(?)
				AND strftime('%w', date(r.read_date, "localtime")) != '0'  -- Exclude Sundays
				GROUP BY date(r.read_date, "localtime")
				HAVING COUNT(DISTINCT user_id) > 0  -- Garante que houve pelo menos uma leitura neste dia
			),
			daily_reads AS (
				SELECT DISTINCT 
					u.id,
					date(r.read_date, 'localtime') as read_date
				FROM users u
				JOIN reading_stats r ON r.user_id = u.id
				WHERE date(r.read_date, "localtime") >= date(?)
				AND date(r.read_date, "localtime") <= date(?)
				ORDER BY read_date DESC
			),
			streak_calc AS (
				SELECT 
					u.id,
					d.date,
					EXISTS (
						SELECT 1 
						FROM daily_reads dr
						WHERE dr.id = u.id AND dr.read_date = d.date
					) as has_read,
					CASE WHEN strftime('%w', d.date) = '0' THEN 1 ELSE 0 END as is_sunday
				FROM users u
				CROSS JOIN dates d
				WHERE d.date <= date(datetime('now', '-3 hours'))
				ORDER BY u.id, d.date DESC
			),
			streak_count AS (
				WITH consecutive_reads AS (
					SELECT 
						id,
						date,
						has_read,
						is_sunday,
						ROW_NUMBER() OVER (PARTITION BY id ORDER BY date DESC) as rn,
						(
							SELECT COUNT(*)
							FROM streak_calc s2
							WHERE s2.id = streak_calc.id
							AND s2.date > streak_calc.date
							AND s2.date < date(datetime('now', '-3 hours'))
							AND s2.has_read = 0
							AND s2.is_sunday = 0
						) as gaps_before_today
					FROM streak_calc
					WHERE has_read = 1 
					OR (
						is_sunday = 1 
						AND EXISTS (
							SELECT 1 
							FROM streak_calc s2 
							WHERE s2.id = streak_calc.id
							AND s2.date > streak_calc.date 
							AND s2.has_read = 1
							AND s2.date <= date(datetime('now', '-3 hours'))
						)
					)
				)
				SELECT 
					id,
					COUNT(*) as current_streak
				FROM consecutive_reads
				WHERE gaps_before_today = 0
				GROUP BY id
			),
			user_stats AS (
				SELECT 
					u.id,
					COALESCE(sc.current_streak, 0) as current_streak,
					u.created_at,
					COUNT(DISTINCT CASE 
						WHEN date(r.read_date, 'localtime') >= date(u.created_at, 'localtime')
						AND nd.date IS NOT NULL  -- Apenas dias com newsletter
						THEN date(r.read_date, 'localtime')
						ELSE NULL 
					END) as total_reads,
					(
						SELECT COUNT(*)
						FROM newsletter_days nd2
						WHERE nd2.date >= date(u.created_at, 'localtime')
					) as total_possible_newsletters,
					CASE 
						WHEN COUNT(r.id) > 0 THEN 1
						ELSE 0
					END as is_active
				FROM users u
				JOIN reading_stats r ON u.id = r.user_id  -- Mudado de LEFT JOIN para JOIN para pegar apenas usuários com leituras
					AND date(r.read_date, "localtime") >= date(?)
					AND date(r.read_date, "localtime") <= date(?)
				LEFT JOIN newsletter_days nd ON date(r.read_date, 'localtime') = nd.date
				LEFT JOIN streak_count sc ON u.id = sc.id
					${additionalWhere}
				WHERE u.email != 'admin@example.com'
				GROUP BY u.id
			),
			user_rates AS (
				SELECT 
					*,
					CASE 
						WHEN total_possible_newsletters > 0 THEN
							ROUND((CAST(total_reads AS FLOAT) / total_possible_newsletters) * 100, 2)
						ELSE 0
					END as opening_rate
				FROM user_stats
			),
			total_stats AS (
				SELECT 
					SUM(total_reads) as all_reads,
					SUM(total_possible_newsletters) as all_possible
				FROM user_stats
			)
			SELECT 
				COUNT(*) as total_users,
				ROUND(AVG(current_streak), 2) as avg_streak,
				ROUND(AVG(opening_rate), 2) as avg_opening_rate,
				SUM(is_active) as active_users
			FROM user_rates`;

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

	async getTopReaders(filters: AdminStatsFilters): Promise<AdminStats['top_readers']> {
		const { startDate, endDate } = filters;
		const baseParams = [startDate, endDate];
		const params: any[] = [...baseParams, ...baseParams, ...baseParams, ...baseParams];
		let additionalWhere = '';

		if (filters.newsletterDate) {
			additionalWhere += ' AND date(r.read_date, "localtime") = ?';
			params.push(filters.newsletterDate);
		}

		if (filters.minStreak) {
			additionalWhere += ' AND u.current_streak >= ?';
			params.push(filters.minStreak);
		}

		const query = `
			WITH RECURSIVE dates(date) AS (
				SELECT date(?, 'localtime')
				UNION ALL
				SELECT date(date, '+1 day')
				FROM dates
				WHERE date < date(?, 'localtime')
			),
			newsletter_days AS (
				SELECT DISTINCT date(read_date, 'localtime') as date
				FROM reading_stats r
				WHERE date(r.read_date, "localtime") >= date(?)
				AND date(r.read_date, "localtime") <= date(?)
				AND strftime('%w', date(r.read_date, "localtime")) != '0'  -- Exclude Sundays
				GROUP BY date(r.read_date, "localtime")
				HAVING COUNT(DISTINCT user_id) > 0  -- Garante que houve pelo menos uma leitura neste dia
			),
			daily_reads AS (
				SELECT DISTINCT 
					u.id,
					date(r.read_date, 'localtime') as read_date
				FROM users u
				JOIN reading_stats r ON r.user_id = u.id
				WHERE date(r.read_date, "localtime") >= date(?)
				AND date(r.read_date, "localtime") <= date(?)
				ORDER BY read_date DESC
			),
			streak_calc AS (
				SELECT 
					u.id,
					d.date,
					EXISTS (
						SELECT 1 
						FROM daily_reads dr
						WHERE dr.id = u.id AND dr.read_date = d.date
					) as has_read,
					CASE WHEN strftime('%w', d.date) = '0' THEN 1 ELSE 0 END as is_sunday
				FROM users u
				CROSS JOIN dates d
				WHERE d.date <= date(datetime('now', '-3 hours'))
				ORDER BY u.id, d.date DESC
			),
			streak_count AS (
				WITH consecutive_reads AS (
					SELECT 
						id,
						date,
						has_read,
						is_sunday,
						ROW_NUMBER() OVER (PARTITION BY id ORDER BY date DESC) as rn,
						(
							SELECT COUNT(*)
							FROM streak_calc s2
							WHERE s2.id = streak_calc.id
							AND s2.date > streak_calc.date
							AND s2.date < date(datetime('now', '-3 hours'))
							AND s2.has_read = 0
							AND s2.is_sunday = 0
						) as gaps_before_today
					FROM streak_calc
					WHERE has_read = 1 
					OR (
						is_sunday = 1 
						AND EXISTS (
							SELECT 1 
							FROM streak_calc s2 
							WHERE s2.id = streak_calc.id
							AND s2.date > streak_calc.date 
							AND s2.has_read = 1
							AND s2.date <= date(datetime('now', '-3 hours'))
						)
					)
				)
				SELECT 
					id,
					COUNT(*) as current_streak
				FROM consecutive_reads
				WHERE gaps_before_today = 0
				GROUP BY id
			),
			user_reads AS (
				SELECT 
					u.id,
					u.email,
					u.created_at,
					COALESCE(sc.current_streak, 0) as streak,
					u.last_read_date,
					COUNT(DISTINCT CASE 
						WHEN date(r.read_date, 'localtime') >= date(u.created_at, 'localtime')
						AND nd.date IS NOT NULL  -- Apenas dias com newsletter
						THEN date(r.read_date, 'localtime')
						ELSE NULL 
					END) as total_reads,
					(
						SELECT COUNT(*)
						FROM newsletter_days nd2
						WHERE nd2.date >= date(u.created_at, 'localtime')
					) as total_possible_newsletters
				FROM users u
				LEFT JOIN reading_stats r ON u.id = r.user_id 
					AND date(r.read_date, "localtime") >= date(?)
					AND date(r.read_date, "localtime") <= date(?)
				LEFT JOIN newsletter_days nd ON date(r.read_date, 'localtime') = nd.date
				LEFT JOIN streak_count sc ON u.id = sc.id
					${additionalWhere}
				WHERE u.email != 'admin@example.com'
				GROUP BY u.id
			)
			SELECT 
				email,
				streak,
				last_read_date as last_read,
				CASE 
					WHEN total_possible_newsletters > 0 THEN
						ROUND((CAST(total_reads AS FLOAT) / total_possible_newsletters) * 100, 2)
					ELSE 0
				END as opening_rate
			FROM user_reads
			WHERE total_reads > 0
			ORDER BY opening_rate DESC, streak DESC
			LIMIT 10`;

		const result = await this.db
			.prepare(query)
			.bind(...params)
			.all();

		return (result?.results as AdminStats['top_readers']) || [];
	}

	async getHistoricalStats(filters: AdminStatsFilters): Promise<HistoricalStats> {
		const params: any[] = [filters.startDate, filters.endDate];
		let additionalWhere = '';

		if (filters.newsletterDate) {
			additionalWhere += ' AND date(r.read_date, "localtime") = ?';
			params.push(filters.newsletterDate);
		}

		if (filters.minStreak) {
			additionalWhere += ' AND u.current_streak >= ?';
			params.push(filters.minStreak);
		}

		const query = `
			WITH RECURSIVE dates(date) AS (
				SELECT date(?, 'localtime')
				UNION ALL
				SELECT date(date, '+1 day')
				FROM dates
				WHERE date < date(?, 'localtime')
			),
			daily_users AS (
				SELECT 
					d.date,
					COUNT(DISTINCT u.id) as total_users,
					ROUND(AVG(u.current_streak), 2) as avg_streak
				FROM dates d
				LEFT JOIN users u ON date(u.created_at, 'localtime') <= d.date
				WHERE u.email != 'admin@example.com'
					${additionalWhere}
				GROUP BY d.date
			),
			daily_reads AS (
				SELECT 
					d.date,
					COUNT(DISTINCT r.user_id) as unique_readers
				FROM dates d
				LEFT JOIN users u ON u.email != 'admin@example.com'
				LEFT JOIN reading_stats r ON r.user_id = u.id 
					AND date(r.read_date, 'localtime') = d.date
					${additionalWhere}
				WHERE strftime('%w', d.date) != '0'  -- Exclui domingos
				GROUP BY d.date
			)
			SELECT 
				d.date,
				COALESCE(du.avg_streak, 0) as avg_streak,
				CASE 
					WHEN du.total_users > 0 THEN
						ROUND((CAST(COALESCE(dr.unique_readers, 0) AS FLOAT) / du.total_users) * 100, 2)
					ELSE 0
				END as opening_rate
			FROM dates d
			LEFT JOIN daily_users du ON d.date = du.date
			LEFT JOIN daily_reads dr ON d.date = dr.date
			WHERE strftime('%w', d.date) != '0'  -- Exclui domingos
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

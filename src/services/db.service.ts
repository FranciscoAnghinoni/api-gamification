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
				) VALUES (?, ?, ?, ?, ?, ?, DATE('now'))
			`
			)
			.bind(user.id, data.post_id, data.utm_source || null, data.utm_medium || null, data.utm_campaign || null, data.utm_channel || null)
			.run();

		// Get the last read date
		const lastRead = await this.getLastReadDate(user.id);
		const today = new Date();
		const todayStr = today.toISOString().split('T')[0];

		let newStreak = 1; // Default to 1 for first read

		if (lastRead) {
			const lastReadDate = new Date(lastRead);
			const yesterday = new Date(today);
			yesterday.setDate(today.getDate() - 1);

			// Format dates to YYYY-MM-DD for comparison
			const lastReadFormatted = lastReadDate.toISOString().split('T')[0];
			const yesterdayFormatted = yesterday.toISOString().split('T')[0];

			if (lastReadFormatted === yesterdayFormatted) {
				// Read yesterday, increment streak
				newStreak = user.current_streak + 1;
			} else if (lastReadFormatted === todayStr) {
				// Already read today, maintain current streak
				newStreak = user.current_streak;
			}
			// Otherwise, it's a gap in reading, start new streak at 1
		}

		// Update the user's streak
		await this.updateUserStreak(user.id, newStreak);
	}

	async getUserStats(userId?: number, email?: string): Promise<UserStats> {
		const query = `
			WITH user_data AS (
				SELECT 
					u.id,
					u.current_streak,
					u.highest_streak,
					u.last_read_date,
					u.created_at,
					COUNT(r.id) as total_reads,
					GROUP_CONCAT(DISTINCT r.utm_source) as sources,
					-- Count days between creation_date and today, excluding Sundays
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
							WHERE strftime('%w', date) != '0'  -- Exclude Sundays (0 = Sunday)
						)
					) as total_possible_newsletters
				FROM users u
				LEFT JOIN reading_stats r ON u.id = r.user_id
				WHERE ${userId ? 'u.id = ?' : 'u.email = ?'}
				GROUP BY u.id
			)
			SELECT 
				COALESCE(current_streak, 0) as current_streak,
				COALESCE(highest_streak, 0) as highest_streak,
				COALESCE(total_reads, 0) as total_reads,
				last_read_date,
				sources,
				CASE 
					WHEN total_possible_newsletters > 0 THEN
						MIN(
							ROUND((CAST(total_reads AS FLOAT) / total_possible_newsletters) * 100, 2),
							100
						)
					ELSE 100  -- If created today, and has reads, then 100%
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

	async getAdminStats(filters?: AdminStatsFilters): Promise<AdminStats> {
		let dateFilter = '1=1';
		const params: any[] = [];

		if (filters?.startDate) {
			dateFilter += ' AND r.read_date >= ?';
			params.push(filters.startDate);
		}
		if (filters?.endDate) {
			dateFilter += ' AND r.read_date <= ?';
			params.push(filters.endDate);
		}

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
				LEFT JOIN reading_stats r ON u.id = r.user_id AND ${dateFilter}
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
			}
		);
	}

	async getTopReaders(filters?: AdminStatsFilters): Promise<AdminStats['top_readers']> {
		let dateFilter = '1=1';
		const params: any[] = [];

		if (filters?.startDate) {
			dateFilter += ' AND r.read_date >= ?';
			params.push(filters.startDate);
		}
		if (filters?.endDate) {
			dateFilter += ' AND r.read_date <= ?';
			params.push(filters.endDate);
		}

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
				LEFT JOIN reading_stats r ON u.id = r.user_id AND ${dateFilter}
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

import { User, WebhookData, ValidationError, UserStats, AdminStats, AdminStatsFilters, PostStats, ReadingHistory } from '../types';
import { generateAutoLoginToken } from '../utils/auth';

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
	constructor(private db: D1Database) {}

	async getUserByAutoLoginToken(token: string): Promise<User | null> {
		return await this.db.prepare('SELECT * FROM users WHERE auto_login_token = ?').bind(token).first<User>();
	}

	async getOrCreateUser(email: string): Promise<User> {
		let user = await this.db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();

		if (!user) {
			const token = generateAutoLoginToken();
			await this.db
				.prepare('INSERT INTO users (email, auto_login_token, current_streak, highest_streak) VALUES (?, ?, 0, 0)')
				.bind(email, token)
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

	async recordRead(data: WebhookData): Promise<void> {
		const user = await this.getOrCreateUser(data.email);

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
	}

	async getUserStats(userId?: number, email?: string): Promise<UserStats> {
		const query = `
			SELECT 
				u.current_streak,
				u.highest_streak,
				COUNT(r.id) as total_reads,
				u.last_read_date,
				GROUP_CONCAT(DISTINCT r.utm_source) as sources
			FROM users u
			LEFT JOIN reading_stats r ON u.id = r.user_id
			WHERE ${userId ? 'u.id = ?' : 'u.email = ?'}
			GROUP BY u.id
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
				history: [],
			}
		);
	}

	async getUserReadingHistory(userId?: number, email?: string): Promise<ReadingHistory[]> {
		const query = `
			SELECT 
				r.read_date as date,
				r.post_id,
				p.title as post_title
			FROM reading_stats r
			LEFT JOIN posts p ON r.post_id = p.id
			JOIN users u ON r.user_id = u.id
			WHERE ${userId ? 'u.id = ?' : 'u.email = ?'}
			ORDER BY r.read_date DESC
		`;

		const result = await this.db
			.prepare(query)
			.bind(userId || email)
			.all();
		const history = result?.results as Array<{
			date: string;
			post_id: string;
			post_title?: string;
		}>;
		return history || [];
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
		let whereClause = '1=1';
		const params: any[] = [];

		if (filters?.startDate) {
			whereClause += ' AND r.read_date >= ?';
			params.push(filters.startDate);
		}
		if (filters?.endDate) {
			whereClause += ' AND r.read_date <= ?';
			params.push(filters.endDate);
		}
		if (filters?.postId) {
			whereClause += ' AND r.post_id = ?';
			params.push(filters.postId);
		}
		if (filters?.minStreak) {
			whereClause += ' AND u.current_streak >= ?';
			params.push(filters.minStreak);
		}

		const basicStats = await this.db
			.prepare(
				`
				SELECT 
					COUNT(DISTINCT u.id) as total_users,
					COALESCE(AVG(u.current_streak), 0) as avg_streak,
					COALESCE(MAX(u.highest_streak), 0) as max_streak,
					COUNT(r.id) as total_reads
				FROM users u
				LEFT JOIN reading_stats r ON u.id = r.user_id
				WHERE ${whereClause}
			`
			)
			.bind(...params)
			.first<Omit<AdminStats, 'top_readers' | 'engagement_over_time'>>();

		const topReaders = await this.db
			.prepare(
				`
				SELECT 
					u.email,
					u.current_streak as streak,
					COUNT(r.id) as reads
				FROM users u
				LEFT JOIN reading_stats r ON u.id = r.user_id
				WHERE ${whereClause}
				GROUP BY u.id
				ORDER BY reads DESC, streak DESC
				LIMIT 10
			`
			)
			.bind(...params)
			.all();

		const engagementOverTime = await this.db
			.prepare(
				`
				SELECT 
					DATE(r.read_date) as date,
					COUNT(*) as reads,
					COUNT(DISTINCT u.id) as unique_readers
				FROM reading_stats r
				JOIN users u ON r.user_id = u.id
				WHERE ${whereClause}
				GROUP BY DATE(r.read_date)
				ORDER BY date DESC
				LIMIT 30
			`
			)
			.bind(...params)
			.all();

		return {
			...basicStats!,
			top_readers: topReaders.results as AdminStats['top_readers'],
			engagement_over_time: engagementOverTime.results as AdminStats['engagement_over_time'],
		};
	}
}

export async function rateLimit(request: Request, env: Env): Promise<boolean> {
	const ip = request.headers.get('cf-connecting-ip');
	const key = `ratelimit:${ip}`;

	// Implementation would depend on your chosen rate limiting solution
	// Could use Workers KV or other storage mechanism
	return true;
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

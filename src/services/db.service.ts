import { User, WebhookData, ValidationError, UserStats, AdminStats } from '../types';

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

	async getUser(email: string): Promise<User | null> {
		return await this.db.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<User>();
	}

	async createUser(email: string, lastReadDate?: string): Promise<D1Result> {
		return this.db
			.prepare('INSERT INTO users (email, last_read_date) VALUES (?, ?)')
			.bind(email, lastReadDate || null)
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

		await this.updateStreak(user.id);
	}

	private async getOrCreateUser(email: string): Promise<{ id: number }> {
		const user = await this.db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>();

		if (user) return user;

		const result = await this.db.prepare('INSERT INTO users (email) VALUES (?)').bind(email).run();

		return { id: result.meta.last_row_id };
	}

	private async updateStreak(userId: number): Promise<void> {
		const lastRead = await this.db
			.prepare('SELECT read_date FROM reading_stats WHERE user_id = ? ORDER BY read_date DESC LIMIT 1')
			.bind(userId)
			.first<{ read_date: string }>();

		if (!lastRead) {
			await this.updateUserStreak(userId, 1);
			return;
		}

		const today = new Date();
		if (today.getDay() === 0) return; // Skip Sundays

		const lastReadDate = new Date(lastRead.read_date);
		const yesterday = new Date(today);
		yesterday.setDate(today.getDate() - 1);

		// If yesterday was Sunday, check Friday
		if (yesterday.getDay() === 0) {
			yesterday.setDate(yesterday.getDate() - 2);
		}

		const user = await this.db.prepare('SELECT current_streak FROM users WHERE id = ?').bind(userId).first<{ current_streak: number }>();

		let newStreak = 1;
		if (lastReadDate.toISOString().split('T')[0] === yesterday.toISOString().split('T')[0]) {
			newStreak = (user?.current_streak || 0) + 1;
		}

		await this.updateUserStreak(userId, newStreak);
	}

	private async updateUserStreak(userId: number, newStreak: number): Promise<void> {
		await this.db
			.prepare(
				`
				UPDATE users 
				SET current_streak = ?, 
					highest_streak = CASE 
						WHEN ? > highest_streak THEN ? 
						ELSE highest_streak 
					END 
				WHERE id = ?
			`
			)
			.bind(newStreak, newStreak, newStreak, userId)
			.run();
	}

	async recordReading(userId: number, pagesRead: number, readDate: string): Promise<D1Result> {
		return this.db
			.prepare('INSERT INTO reading_stats (user_id, pages_read, read_date) VALUES (?, ?, ?)')
			.bind(userId, pagesRead, readDate)
			.run();
	}

	async getUserStats(userId: number): Promise<UserStats> {
		const stats = await this.db
			.prepare(
				`
			SELECT 
				u.current_streak,
				u.highest_streak,
				COUNT(r.id) as total_reads,
				MAX(r.read_date) as last_read_date,
				GROUP_CONCAT(DISTINCT r.utm_source) as sources
			FROM users u
			LEFT JOIN reading_stats r ON u.id = r.user_id
			WHERE u.id = ?
			GROUP BY u.id
		`
			)
			.bind(userId)
			.first<UserStats>();

		return (
			stats || {
				current_streak: 0,
				highest_streak: 0,
				total_reads: 0,
				last_read_date: null,
				sources: [],
			}
		);
	}

	async getAdminStats(): Promise<AdminStats> {
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
				`
			)
			.first<Omit<AdminStats, 'top_readers'>>();

		if (!basicStats) {
			return {
				total_users: 0,
				avg_streak: 0,
				max_streak: 0,
				total_reads: 0,
				top_readers: [],
			};
		}

		const topReaders = await this.db
			.prepare(
				`
				SELECT 
					u.email,
					u.current_streak as streak,
					COUNT(r.id) as reads
				FROM users u
				LEFT JOIN reading_stats r ON u.id = r.user_id
				GROUP BY u.id
				ORDER BY reads DESC, streak DESC
				LIMIT 10
				`
			)
			.all();

		return {
			...basicStats,
			top_readers: topReaders.results as AdminStats['top_readers'],
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

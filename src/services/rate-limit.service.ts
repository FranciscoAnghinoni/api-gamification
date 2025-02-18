export class RateLimitService {
	private readonly RATE_LIMIT = 100; // requests per minute
	private readonly WINDOW_SIZE = 60; // seconds

	constructor(private db: D1Database) {}

	async isRateLimited(ip: string): Promise<boolean> {
		const now = Math.floor(Date.now() / 1000);
		const windowStart = now - this.WINDOW_SIZE;

		const count = await this.db
			.prepare(
				`
                SELECT COUNT(*) as count
                FROM reading_stats
                WHERE created_at >= datetime(?, 'unixepoch')
                AND ip = ?
                `
			)
			.bind(windowStart, ip)
			.first<{ count: number }>();

		return (count?.count || 0) >= this.RATE_LIMIT;
	}
}

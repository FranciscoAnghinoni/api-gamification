export interface Env {
	DB: D1Database;
	BEEHIIV_API_URL: string;
}

export interface WebhookData {
	email: string;
	post_id: string;
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
	utm_channel?: string;
}

export interface UserStats {
	current_streak: number;
	highest_streak: number;
	total_reads: number;
	last_read_date: string | null;
	sources: string[];
}

export interface AdminStats {
	total_users: number;
	avg_streak: number;
	max_streak: number;
	total_reads: number;
	top_readers: {
		email: string;
		streak: number;
		reads: number;
	}[];
}

export interface User {
	email: string;
	current_streak: number;
	highest_streak: number;
	last_read_date: string;
	created_at: string;
}

export class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ValidationError';
	}
}

/**
 * API Endpoints:
 *
 * GET /?email=<email>&id=<post_id>
 * - Records a newsletter read event
 * - Optional UTM parameters: utm_source, utm_medium, utm_campaign, utm_channel
 *
 * POST /api/users
 * - Creates a new user
 * - Body: { username: string }
 *
 * GET /api/stats?userId=<id>
 * - Gets user statistics
 * - Returns: UserStats
 *
 * GET /api/admin/stats
 * - Gets admin dashboard statistics
 * - Returns: AdminStats
 *
 * POST /api/reading
 * - Records a reading event
 * - Body: { userId: number, pagesRead: number }
 */

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

export interface User {
	id: number;
	email: string;
	current_streak: number;
	highest_streak: number;
	last_read_date: string | null;
}

export interface ReadingHistory {
	date: string;
	post_id: string;
	post_title?: string;
}

export interface UserStats {
	current_streak: number;
	highest_streak: number;
	total_reads: number;
	last_read_date: string | null;
	sources: string[];
	opening_rate: number;
	history: ReadingHistory[];
}

export interface PostStats {
	total_reads: number;
	unique_readers: number;
	utm_breakdown: {
		source: { [key: string]: number };
		medium: { [key: string]: number };
		campaign: { [key: string]: number };
		channel: { [key: string]: number };
	};
}

export interface AdminStats {
	total_users: number;
	avg_streak: number;
	avg_opening_rate: number;
	active_users_30d: number;
	top_readers: {
		email: string;
		streak: number;
		opening_rate: number;
		last_read: string;
	}[];
}

export interface AdminStatsFilters {
	startDate?: string;
	endDate?: string;
}

export interface AuthUser {
	id: number;
	email: string;
	password_hash: string;
	created_at: string;
	updated_at: string;
}

export interface RegisterRequest {
	email: string;
	password: string;
}

export interface LoginRequest {
	email: string;
	password: string;
}

export interface ChangePasswordRequest {
	email: string;
	currentPassword: string;
	newPassword: string;
}

export interface AuthResponse {
	token: string;
	user: {
		id: number;
		email: string;
		is_admin: boolean;
	};
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
 * Authentication:
 * POST /api/auth/register
 * - Registers a new user
 * - Body: { email: string, password: string }
 * - Returns: AuthResponse
 *
 * POST /api/auth/login
 * - Authenticates a user
 * - Body: { email: string, password: string }
 * - Returns: AuthResponse
 *
 * POST /api/auth/change-password
 * - Changes user password
 * - Body: { email: string, currentPassword: string, newPassword: string }
 * - Returns: { success: true }
 *
 * User Statistics:
 * GET /api/stats?userId=<id>&email=<email>
 * - Gets user statistics (requires either userId or email)
 * - Returns: UserStats {
 *     current_streak: number,
 *     highest_streak: number,
 *     total_reads: number,
 *     last_read_date: string | null,
 *     sources: string[],
 *     opening_rate: number,
 *     history: ReadingHistory[]
 *   }
 *
 * Admin Dashboard:
 * GET /api/stats/admin
 * - Gets basic admin dashboard statistics
 * - Optional Query Parameters: startDate, endDate (YYYY-MM-DD format)
 * - Returns: {
 *     total_users: number,
 *     avg_streak: number,
 *     avg_opening_rate: number,
 *     active_users: number
 *   }
 *
 * GET /api/stats/admin/top-readers
 * - Gets top 10 readers sorted by opening rate and streak
 * - Optional Query Parameters: startDate, endDate (YYYY-MM-DD format)
 * - Returns: Array<{
 *     email: string,
 *     streak: number,
 *     opening_rate: number,
 *     last_read: string
 *   }>
 *
 * Newsletter Tracking:
 * GET /?email=<email>&id=<post_id>
 * - Records a newsletter read event
 * - Optional UTM Parameters: utm_source, utm_medium, utm_campaign, utm_channel
 * - Returns: { success: true }
 *
 * Post Statistics:
 * GET /api/stats/post/<post_id>
 * - Gets statistics for a specific post
 * - Returns: PostStats {
 *     total_reads: number,
 *     unique_readers: number,
 *     utm_breakdown: {
 *       source: { [key: string]: number },
 *       medium: { [key: string]: number },
 *       campaign: { [key: string]: number },
 *       channel: { [key: string]: number }
 *     }
 *   }
 */

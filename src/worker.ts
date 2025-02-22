import { DatabaseService } from './services/db.service';
import { StreakService } from './services/streak.service';
import { Env, ValidationError, RegisterRequest, LoginRequest, ChangePasswordRequest, AuthResponse } from './types';

// Utility functions for authentication
async function hashPassword(password: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(password);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function generateToken(userId: number, email: string): Promise<string> {
	// In a real application, you'd want to use a proper JWT library
	// For now, we'll create a simple encoded token
	const payload = {
		userId,
		email,
		exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
	};
	return btoa(JSON.stringify(payload));
}

async function verifyToken(token: string): Promise<{ userId: number; email: string } | null> {
	try {
		const payload = JSON.parse(atob(token));
		if (payload.exp < Date.now()) {
			return null;
		}
		return { userId: payload.userId, email: payload.email };
	} catch {
		return null;
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const allowedOrigins = ['https://the-news-gamification-ten.vercel.app', 'http://localhost:5173', 'http://localhost:3000'];
		const origin = request.headers.get('Origin') || '';

		// CORS headers to be applied to all responses
		const corsHeaders = {
			'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			'Access-Control-Allow-Credentials': 'true',
		};

		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					...corsHeaders,
					'Access-Control-Max-Age': '86400',
				},
			});
		}

		const db = new DatabaseService(env.DB);
		const streakService = new StreakService(db);
		const url = new URL(request.url);

		try {
			let responseData;
			let status = 200;

			switch (true) {
				case request.method === 'GET' && url.pathname === '/': {
					const email = url.searchParams.get('email') ?? undefined;
					const postId = url.searchParams.get('id') ?? undefined;
					const utmSource = url.searchParams.get('utm_source') ?? undefined;
					const utmMedium = url.searchParams.get('utm_medium') ?? undefined;
					const utmCampaign = url.searchParams.get('utm_campaign') ?? undefined;
					const utmChannel = url.searchParams.get('utm_channel') ?? undefined;

					if (!email || !postId) {
						throw new ValidationError('Both email and newsletter ID are required to record a read');
					}

					try {
						await db.recordRead({
							email,
							post_id: postId,
							utm_source: utmSource,
							utm_medium: utmMedium,
							utm_campaign: utmCampaign,
							utm_channel: utmChannel,
						});

						// Update streak after recording read
						await streakService.updateStreak(email);
						responseData = { success: true };
					} catch (error) {
						console.error('Error recording read:', error);
						if (error instanceof ValidationError) {
							throw error;
						}
						throw new Error('Failed to record newsletter read. Please try again later.');
					}
					break;
				}

				case request.method === 'GET' && url.pathname === '/api/stats': {
					const email = url.searchParams.get('email') ?? undefined;

					if (!email) {
						throw new ValidationError('Email is required to fetch user statistics');
					}

					const stats = await db.getUserStats(undefined, email);
					const history = await db.getUserReadingHistory(undefined, email);
					responseData = { ...stats, history };
					break;
				}

				case request.method === 'GET' && url.pathname === '/api/stats/admin': {
					const startDate = url.searchParams.get('startDate') ?? undefined;
					const endDate = url.searchParams.get('endDate') ?? undefined;

					// Verificar autenticação e permissão de admin
					const authHeader = request.headers.get('Authorization');
					if (!authHeader?.startsWith('Bearer ')) {
						throw new ValidationError('Authentication token is required for admin access');
					}

					const token = authHeader.slice(7);
					const userData = await verifyToken(token);
					if (!userData) {
						throw new ValidationError('Invalid or expired authentication token');
					}

					// Verificar se o usuário é admin
					const user = await db.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userData.userId).first<{ is_admin: boolean }>();
					if (!user?.is_admin) {
						throw new ValidationError('Admin privileges are required to access this resource');
					}

					responseData = await db.getAdminStats({ startDate, endDate });
					break;
				}

				case request.method === 'GET' && url.pathname === '/api/stats/admin/top-readers': {
					const startDate = url.searchParams.get('startDate') ?? undefined;
					const endDate = url.searchParams.get('endDate') ?? undefined;

					// Verificar autenticação e permissão de admin
					const authHeader = request.headers.get('Authorization');
					if (!authHeader?.startsWith('Bearer ')) {
						throw new ValidationError('Authentication token is required for admin access');
					}

					const token = authHeader.slice(7);
					const userData = await verifyToken(token);
					if (!userData) {
						throw new ValidationError('Invalid or expired authentication token');
					}

					// Verificar se o usuário é admin
					const user = await db.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userData.userId).first<{ is_admin: boolean }>();
					if (!user?.is_admin) {
						throw new ValidationError('Admin privileges are required to access this resource');
					}

					responseData = await db.getTopReaders({ startDate, endDate });
					break;
				}

				case request.method === 'GET' && url.pathname === '/api/stats/admin/historical': {
					const startDate = url.searchParams.get('startDate') ?? undefined;
					const endDate = url.searchParams.get('endDate') ?? undefined;
					const period = url.searchParams.get('period') as '7d' | '30d' | '90d' | undefined;

					// Verificar autenticação e permissão de admin
					const authHeader = request.headers.get('Authorization');
					if (!authHeader?.startsWith('Bearer ')) {
						throw new ValidationError('Authentication token is required for admin access');
					}

					const token = authHeader.slice(7);
					const userData = await verifyToken(token);
					if (!userData) {
						throw new ValidationError('Invalid or expired authentication token');
					}

					// Verificar se o usuário é admin
					const user = await db.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userData.userId).first<{ is_admin: boolean }>();
					if (!user?.is_admin) {
						throw new ValidationError('Admin privileges are required to access this resource');
					}

					responseData = await db.getHistoricalStats({ startDate, endDate, period });
					break;
				}

				case request.method === 'GET' && url.pathname === '/api/posts': {
					const postId = url.searchParams.get('id');
					if (!postId) {
						throw new ValidationError('Newsletter ID is required to fetch post details');
					}

					const response = await fetch(`${env.BEEHIIV_API_URL}/posts/${postId}`);
					if (!response.ok) {
						throw new Error('Failed to fetch newsletter details from Beehiiv. Please try again later.');
					}

					responseData = await response.json();
					break;
				}

				case request.method === 'GET' && url.pathname === '/api/posts/stats': {
					const postId = url.searchParams.get('id');
					if (!postId) {
						throw new ValidationError('Newsletter ID is required to fetch post statistics');
					}

					responseData = await db.getPostStats(postId);
					break;
				}

				case request.method === 'POST' && url.pathname === '/api/auth/register': {
					if (!request.body) {
						throw new ValidationError('Request body is required for registration');
					}

					const { email, password }: RegisterRequest = await request.json();

					if (!email?.trim() || !password?.trim()) {
						throw new ValidationError('Both email and password are required for registration');
					}

					// Check if user exists from webhook
					const existingUser = await db.prepare('SELECT id, password_hash FROM users WHERE email = ?').bind(email).first();

					if (!existingUser) {
						throw new ValidationError('You need to subscribe to the newsletter before registering. Please subscribe first.');
					}

					// Check if user already has a password (already registered)
					const typedUser = existingUser as { id: number; password_hash: string | null };
					if (typedUser.password_hash) {
						throw new ValidationError('This email is already registered. Please login instead.');
					}

					const passwordHash = await hashPassword(password);
					const timestamp = new Date().toISOString();

					// Update existing user with password
					await db
						.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
						.bind(passwordHash, timestamp, typedUser.id)
						.run();

					const token = await generateToken(typedUser.id, email);
					responseData = {
						token,
						user: {
							id: typedUser.id,
							email,
						},
					};
					break;
				}

				case request.method === 'POST' && url.pathname === '/api/auth/login': {
					if (!request.body) {
						throw new ValidationError('Request body is required for login');
					}

					const { email, password }: LoginRequest = await request.json();

					if (!email?.trim() || !password?.trim()) {
						throw new ValidationError('Both email and password are required for login');
					}

					const user = await db.prepare('SELECT id, email, password_hash, is_admin FROM users WHERE email = ?').bind(email).first();

					if (!user) {
						throw new ValidationError('Invalid email or password');
					}

					const typedUser = user as { id: number; email: string; password_hash: string; is_admin: boolean };
					const passwordHash = await hashPassword(password);
					if (passwordHash !== typedUser.password_hash) {
						throw new ValidationError('Invalid email or password');
					}

					const token = await generateToken(typedUser.id, typedUser.email);
					responseData = {
						token,
						user: {
							id: typedUser.id,
							email: typedUser.email,
							is_admin: typedUser.is_admin,
						},
					};
					break;
				}

				case request.method === 'POST' && url.pathname === '/api/auth/change-password': {
					const authHeader = request.headers.get('Authorization');
					if (!authHeader?.startsWith('Bearer ')) {
						throw new ValidationError('Authentication token is required to change password');
					}

					const token = authHeader.slice(7);
					const userData = await verifyToken(token);
					if (!userData) {
						throw new ValidationError('Invalid or expired authentication token');
					}

					if (!request.body) {
						throw new ValidationError('Request body is required to change password');
					}

					const { currentPassword, newPassword }: ChangePasswordRequest = await request.json();

					if (!currentPassword?.trim() || !newPassword?.trim()) {
						throw new ValidationError('Both current password and new password are required');
					}

					const user = await db.prepare('SELECT id, password_hash FROM users WHERE id = ?').bind(userData.userId).first();

					if (!user) {
						throw new ValidationError('User not found');
					}

					const typedUser = user as { id: number; password_hash: string };
					const currentPasswordHash = await hashPassword(currentPassword);
					if (currentPasswordHash !== typedUser.password_hash) {
						throw new ValidationError('Current password is incorrect');
					}

					const newPasswordHash = await hashPassword(newPassword);
					const timestamp = new Date().toISOString();

					await db
						.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
						.bind(newPasswordHash, timestamp, userData.userId)
						.run();

					responseData = { success: true };
					break;
				}

				default:
					status = 404;
					responseData = { error: 'Endpoint not found' };
			}

			return new Response(JSON.stringify(responseData), {
				status,
				headers: {
					...corsHeaders,
					'Content-Type': 'application/json',
				},
			});
		} catch (error) {
			console.error('Error:', error);
			const status = error instanceof ValidationError ? 400 : 500;
			const errorMessage =
				error instanceof ValidationError
					? error.message
					: error instanceof Error
					? error.message
					: 'An unexpected error occurred. Please try again later.';

			return new Response(JSON.stringify({ error: errorMessage }), {
				status,
				headers: {
					...corsHeaders,
					'Content-Type': 'application/json',
				},
			});
		}
	},
};

async function handleUserStats(request: Request, db: D1Database) {
	const url = new URL(request.url);
	const email = url.searchParams.get('email');

	if (!email) {
		return new Response('Email required', { status: 400 });
	}

	const stats = await db
		.prepare(
			`
    SELECT 
      u.current_streak,
      u.highest_streak,
      COUNT(r.id) as total_reads,
      u.last_read_date
    FROM users u
    LEFT JOIN reads r ON u.email = r.email
    WHERE u.email = ?
    GROUP BY u.email
  `
		)
		.bind(email)
		.first();

	return new Response(JSON.stringify(stats), {
		headers: { 'Content-Type': 'application/json' },
	});
}

async function handleAdminStats(db: D1Database) {
	const stats = await db
		.prepare(
			`
    SELECT 
      COUNT(DISTINCT email) as total_users,
      AVG(current_streak) as avg_streak,
      MAX(highest_streak) as max_streak,
      COUNT(*) as total_reads
    FROM users
  `
		)
		.first();

	const topReaders = await db
		.prepare(
			`
    SELECT 
      u.email,
      u.current_streak,
      COUNT(r.id) as read_count
    FROM users u
    LEFT JOIN reads r ON u.email = r.email
    GROUP BY u.email
    ORDER BY read_count DESC
    LIMIT 10
  `
		)
		.all();

	return new Response(
		JSON.stringify({
			overall: stats,
			topReaders: topReaders.results,
		}),
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
}

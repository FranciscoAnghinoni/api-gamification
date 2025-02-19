import { DatabaseService } from './services/db.service';
import { RateLimitService } from './services/rate-limit.service';
import { StreakService } from './services/streak.service';
import { Env, ValidationError } from './types';

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
		const rateLimiter = new RateLimitService(env.DB);
		const url = new URL(request.url);
		const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';

		try {
			// Check rate limit for all endpoints except admin
			if (!url.pathname.startsWith('/api/admin') && (await rateLimiter.isRateLimited(ip))) {
				return new Response(JSON.stringify({ error: 'Too many requests' }), {
					status: 429,
					headers: {
						...corsHeaders,
						'Content-Type': 'application/json',
					},
				});
			}

			let responseData;
			let status = 200;

			switch (true) {
				case request.method === 'GET' && url.pathname === '/': {
					const email = url.searchParams.get('email');
					const postId = url.searchParams.get('id');

					if (!email || !postId) {
						throw new ValidationError('Email and id are required');
					}

					try {
						await db.recordRead({
							email,
							post_id: postId,
							utm_source: url.searchParams.get('utm_source') || undefined,
							utm_medium: url.searchParams.get('utm_medium') || undefined,
							utm_campaign: url.searchParams.get('utm_campaign') || undefined,
							utm_channel: url.searchParams.get('utm_channel') || undefined,
						});

						// Update streak after recording read
						await streakService.updateStreak(email);
						responseData = { success: true };
					} catch (error) {
						console.error('Error recording read:', error);
						throw new Error('Failed to record read');
					}
					break;
				}

				case request.method === 'GET' && url.pathname === '/api/stats': {
					const userId = url.searchParams.get('userId');
					const email = url.searchParams.get('email');

					if (!userId && !email) {
						throw new ValidationError('Either userId or email is required');
					}

					const stats = await db.getUserStats(userId ? parseInt(userId, 10) : undefined, email);
					const history = await db.getUserReadingHistory(userId ? parseInt(userId, 10) : undefined, email);
					responseData = { ...stats, history };
					break;
				}

				case request.method === 'GET' && url.pathname === '/api/admin/stats': {
					const startDate = url.searchParams.get('startDate');
					const endDate = url.searchParams.get('endDate');
					const postId = url.searchParams.get('postId');
					const minStreak = url.searchParams.get('minStreak');

					responseData = await db.getAdminStats({
						startDate,
						endDate,
						postId,
						minStreak: minStreak ? parseInt(minStreak, 10) : undefined,
					});
					break;
				}

				case request.method === 'GET' && url.pathname === '/api/posts': {
					const postId = url.searchParams.get('id');
					if (!postId) {
						throw new ValidationError('Post ID is required');
					}

					const response = await fetch(`${env.BEEHIIV_API_URL}/posts/${postId}`);
					if (!response.ok) {
						throw new Error('Failed to fetch post details');
					}

					responseData = await response.json();
					break;
				}

				case request.method === 'GET' && url.pathname === '/api/posts/stats': {
					const postId = url.searchParams.get('id');
					if (!postId) {
						throw new ValidationError('Post ID is required');
					}

					responseData = await db.getPostStats(postId);
					break;
				}

				default:
					status = 404;
					responseData = { error: 'Not Found' };
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
			const errorMessage = error instanceof ValidationError ? error.message : 'Internal Server Error';

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

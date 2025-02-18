import { Env, WebhookData, ValidationError } from './types';
import { DatabaseService } from './services/db.service';
import { StreakService } from './services/streak.service';
import { RateLimitService } from './services/rate-limit.service';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': 'http://localhost:5173',
					'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
					'Access-Control-Allow-Credentials': 'true',
					'Access-Control-Max-Age': '86400',
				},
			});
		}

		const ALLOWED_ORIGIN = env.ENVIRONMENT === 'production' ? 'https://your-production-domain.com' : 'http://localhost:5173';

		// Add CORS headers to all responses
		const corsHeaders = {
			'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			'Access-Control-Allow-Credentials': 'true',
		};

		const db = new DatabaseService(env.DB);
		const rateLimiter = new RateLimitService(env.DB);
		const url = new URL(request.url);
		const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';

		try {
			// Check rate limit for all endpoints except admin
			if (!url.pathname.startsWith('/api/admin') && (await rateLimiter.isRateLimited(ip))) {
				return Response.json({ error: 'Too many requests' }, { status: 429 });
			}

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
						return new Response('OK', { status: 200 });
					} catch (error) {
						console.error('Error recording read:', error);
						return Response.json({ error: 'Failed to record read' }, { status: 500 });
					}
				}

				case request.method === 'POST' && url.pathname === '/api/reading': {
					const data = (await request.json()) as { userId: number; pagesRead: number };
					if (!data.userId || !data.pagesRead) {
						throw new ValidationError('userId and pagesRead are required');
					}
					const result = await db.recordReading(data.userId, data.pagesRead, new Date().toISOString().split('T')[0]);
					return Response.json({ success: true, id: result.meta.last_row_id });
				}

				case request.method === 'POST' && url.pathname === '/api/users': {
					const body = (await request.json()) as { username: string };
					if (!body.username) {
						throw new ValidationError('Username is required');
					}
					const result = await db.createUser(body.username);
					return Response.json({ success: true, userId: result.meta.last_row_id });
				}

				case request.method === 'GET' && url.pathname === '/api/stats': {
					const userId = url.searchParams.get('userId');
					if (!userId) {
						throw new ValidationError('userId is required');
					}
					const stats = await db.getUserStats(parseInt(userId, 10));
					return Response.json(stats);
				}

				case request.method === 'GET' && url.pathname === '/api/admin/stats': {
					const db = new DatabaseService(env.DB);
					const stats = await db.getAdminStats();
					return Response.json(stats);
				}

				default:
					return new Response('Not Found', { status: 404 });
			}
		} catch (error) {
			console.error('Error:', error);
			if (error instanceof ValidationError) {
				return Response.json({ error: error.message }, { status: 400 });
			}
			return Response.json({ error: 'Internal Server Error' }, { status: 500 });
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

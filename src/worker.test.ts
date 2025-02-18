import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './worker';
import { Env } from './types';

describe('Reading Stats API', () => {
	let env: Env;
	let ctx: ExecutionContext;

	beforeEach(() => {
		const mockDb = {
			prepare: vi.fn(() => ({
				bind: vi.fn(() => ({
					run: vi.fn().mockResolvedValue({ meta: { last_row_id: 1 } }),
					all: vi.fn().mockResolvedValue({ results: [] }),
					first: vi.fn().mockResolvedValue(null),
				})),
			})),
		};

		env = {
			DB: mockDb as unknown as D1Database,
			BEEHIIV_API_URL: 'https://api.test',
		};
		ctx = {} as ExecutionContext;
	});

	it('should handle webhook read events', async () => {
		const request = new Request('http://localhost/?email=test@example.com&id=post_123&utm_source=tiktok', {
			method: 'GET',
		});

		const response = await worker.fetch(request, env, ctx);
		expect(response.status).toBe(200);
	});

	it('should handle user stats request', async () => {
		const request = new Request('http://localhost/api/stats?userId=1', {
			method: 'GET',
		});

		const response = await worker.fetch(request, env, ctx);
		expect(response.status).toBe(200);
	});

	it('should handle user creation', async () => {
		const request = new Request('http://localhost/api/users', {
			method: 'POST',
			body: JSON.stringify({ username: 'testuser' }),
		});

		const response = await worker.fetch(request, env, ctx);
		expect(response.status).toBe(200);

		const data = (await response.json()) as { userId: number };
		expect(data.userId).toBe(1);
	});
});

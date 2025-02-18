import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		pool: '@cloudflare/vitest-pool-workers',
		poolOptions: {
			workers: {
				miniflare: {
					compatibilityDate: '2024-02-18',
				},
			},
		},
		include: ['src/**/*.{test,spec}.ts'],
		exclude: ['node_modules', 'test'],
	},
});

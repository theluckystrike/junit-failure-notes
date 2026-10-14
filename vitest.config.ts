import { defineConfig } from 'vitest/config';

// obsidian ships typings only, so tests run against obsidian-test-mocks in jsdom.
export default defineConfig({
	resolve: { alias: { obsidian: 'obsidian-test-mocks/obsidian' } },
	test: {
		environment: 'jsdom',
		setupFiles: ['obsidian-test-mocks/vitest-setup'],
		include: ['tests/**/*.test.ts'],
		// Large-input regression tests need more than 5 seconds on shared CI runners.
		testTimeout: 30000,
	},
});

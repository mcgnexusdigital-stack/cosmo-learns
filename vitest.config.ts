import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{js,ts}'],
    exclude: ['tests/firestore-rules.test.js', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['scripts/**/*.js', 'functions/src/**/*.ts'],
      exclude: ['functions/lib/**', 'node_modules/**'],
      thresholds: {
        lines:     60,
        functions: 60,
        branches:  50,
        statements:60,
      },
    },
  },
});

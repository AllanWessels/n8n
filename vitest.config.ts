import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Never scan git worktrees (used by the parallel build agents) or build output.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**'],
      exclude: ['**/*.d.ts', '**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});

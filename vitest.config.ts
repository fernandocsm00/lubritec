import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./server/tests/setup.ts'],
    include: ['server/tests/**/*.test.ts'],
    // Tests share a single Postgres test DB and truncate in beforeEach;
    // running test files in parallel causes truncates/inserts to collide.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});

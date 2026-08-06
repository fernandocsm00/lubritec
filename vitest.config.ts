import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    globalSetup: ['./server/tests/globalSetup.ts'],
    setupFiles: ['./server/tests/setup.ts'],
    // src/**: só lógica PURA do front (sem DOM) — o environment é node e não há
    // jsdom/testing-library no projeto. Componente continua fora de teste.
    include: ['server/tests/**/*.test.ts', 'src/**/*.test.ts'],
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

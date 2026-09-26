import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Point every run at a scratch database and the host compiler.
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // The sandbox is CPU-bound and shares one SQLite file, so keep it serial.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});

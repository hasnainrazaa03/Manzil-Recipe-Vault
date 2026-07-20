import { defineConfig } from 'vitest/config';

// The server reads NODE_ENV at import time (src/config/env.ts), so it has to be
// set before anything under src/ is loaded.
process.env.NODE_ENV = 'test';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: 'test' },
    include: ['tests/**/*.test.ts'],
    // Each file gets its own in-memory Mongo; running them in one process at a
    // time keeps the memory footprint sane and the collections isolated.
    pool: 'forks',
  },
});

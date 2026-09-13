import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // These suites share one database; unlimited Discover can see other suites' fixtures.
    fileParallelism: false,
    include: ['tests/integration/**/*.test.ts'],
  },
});

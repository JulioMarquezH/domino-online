import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', root: './shared', include: ['test/**/*.test.ts'] } },
      { test: { name: 'server', root: './server', include: ['test/**/*.test.ts'] } },
      { test: { name: 'web', root: './web', include: ['src/**/*.test.ts'] } },
    ],
  },
});

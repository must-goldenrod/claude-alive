import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/core/vitest.config.ts',
      'packages/server/vitest.config.ts',
      'packages/hooks/vitest.config.ts',
      'packages/ui/vitest.config.ts',
    ],
  },
});

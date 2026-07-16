import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'storage',
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});

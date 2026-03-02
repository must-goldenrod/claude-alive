import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});

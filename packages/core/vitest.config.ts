import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});

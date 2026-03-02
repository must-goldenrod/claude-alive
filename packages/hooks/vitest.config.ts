import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'hooks',
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});

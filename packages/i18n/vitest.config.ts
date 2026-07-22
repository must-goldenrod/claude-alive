import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'i18n',
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});

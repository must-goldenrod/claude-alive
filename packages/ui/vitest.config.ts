import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineProject({
  plugins: [react()],
  test: {
    name: 'ui',
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});

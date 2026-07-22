import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';

// React picks its build from process.env.NODE_ENV at require time. With an
// ambient NODE_ENV=production (common in a dev shell) it loads the production
// bundle, which omits `React.act`; @testing-library then falls back to
// react-dom/test-utils, whose production build throws "React.act is not a
// function". Pin the value here so the suite does not depend on the shell.
process.env.NODE_ENV = 'test';

export default defineProject({
  plugins: [react()],
  test: {
    name: 'ui',
    environment: 'jsdom',
    env: { NODE_ENV: 'test' },
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});

import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Pin the built-in model preset so a developer's ~/.claude-alive/models.json
    // cannot change what the catalogue tests see.
    env: { CA_DELEGATE_MODELS_FILE: 'builtin' },
  },
});

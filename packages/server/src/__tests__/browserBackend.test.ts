import { describe, it, expect } from 'vitest';
import { chooseBackend } from '../browser/session.js';

describe('chooseBackend', () => {
  it('prefers the API when a key is present — cheaper and faster than the CLI', () => {
    expect(chooseBackend({}, { ANTHROPIC_API_KEY: 'sk-x' }, true)).toBe('api');
  });

  it('falls back to the CLI when no key exists but the CLI is installed', () => {
    expect(chooseBackend({}, {}, true)).toBe('cli');
  });

  it('reports none when neither a key nor the CLI is available', () => {
    expect(chooseBackend({}, {}, false)).toBe('none');
  });

  it('honours an explicit cli request even when a key is present', () => {
    expect(chooseBackend({ backend: 'cli' }, { ANTHROPIC_API_KEY: 'sk-x' }, true)).toBe('cli');
  });

  it('honours an explicit api request and does not silently fall back', () => {
    expect(chooseBackend({ backend: 'api' }, {}, true)).toBe('none');
  });

  it('returns none when the caller disables inference entirely', () => {
    expect(chooseBackend({ backend: 'none' }, { ANTHROPIC_API_KEY: 'sk-x' }, true)).toBe('none');
  });

  it('treats an empty key as absent', () => {
    expect(chooseBackend({}, { ANTHROPIC_API_KEY: '' }, true)).toBe('cli');
  });

  it('uses an explicitly passed apiKey over the environment', () => {
    expect(chooseBackend({ apiKey: 'sk-y' }, {}, false)).toBe('api');
  });
});

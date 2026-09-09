import { describe, it, expect, vi } from 'vitest';
import { ensureLocalToken } from '../localToken.js';

function deps(existing = '') {
  const state = { text: existing, mode: 0 };
  return {
    state,
    read: () => state.text,
    write: (_p: string, text: string) => { state.text = text; },
    chmod: (_p: string, mode: number) => { state.mode = mode; },
    generate: () => 'generated-token-value-0123456789',
  };
}

describe('ensureLocalToken', () => {
  it('keeps a token that is already configured', () => {
    const d = deps();
    const env = { CLAUDE_ALIVE_LOCAL_TOKEN: 'existing-token-value-0123456789' };
    expect(ensureLocalToken('/env', env, d)).toBe('existing-token-value-0123456789');
    expect(d.state.text).toBe('');
  });

  it('generates one and persists it when absent', () => {
    const d = deps('LITELLM_KEY=abc\n');
    const env: NodeJS.ProcessEnv = {};
    const token = ensureLocalToken('/env', env, d);
    expect(token).toBe('generated-token-value-0123456789');
    expect(env.CLAUDE_ALIVE_LOCAL_TOKEN).toBe(token);
    expect(d.state.text).toContain('LITELLM_KEY=abc');
    expect(d.state.text).toContain(`CLAUDE_ALIVE_LOCAL_TOKEN=${token}`);
  });

  it('locks the file down to the owner — the token is the local trust boundary', () => {
    const d = deps();
    ensureLocalToken('/env', {}, d);
    expect(d.state.mode).toBe(0o600);
  });

  it('keeps a trailing newline rather than gluing onto the previous line', () => {
    const d = deps('A=1');
    ensureLocalToken('/env', {}, d);
    expect(d.state.text).toBe('A=1\nCLAUDE_ALIVE_LOCAL_TOKEN=generated-token-value-0123456789\n');
  });

  it('survives an unreadable env file by writing a fresh one', () => {
    const d = deps();
    d.read = vi.fn(() => { throw new Error('ENOENT'); });
    const token = ensureLocalToken('/env', {}, d);
    expect(d.state.text).toBe(`CLAUDE_ALIVE_LOCAL_TOKEN=${token}\n`);
  });
});

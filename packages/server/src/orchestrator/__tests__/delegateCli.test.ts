import { describe, it, expect } from 'vitest';
import { runDelegateCli, DEFAULT_DELEGATE_MODEL } from '../delegateCli.js';

const noStdin = async () => '';

describe('runDelegateCli', () => {
  it('delegates the prompt arg to the model and prints the answer', async () => {
    let seen: { model: string; prompt: string } | null = null;
    const r = await runDelegateCli(
      ['--model', 'gemini/x', 'summarize', 'this'],
      {},
      noStdin,
      { chat: async (model, prompt) => { seen = { model, prompt }; return { content: 'ANSWER', usage: { totalTokens: 9 } }; } },
    );
    expect(seen).toEqual({ model: 'gemini/x', prompt: 'summarize this' });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('ANSWER');
    expect(r.stderr).toContain('"totalTokens":9');
  });

  it('falls back to stdin when no prompt arg is given, with the default model', async () => {
    let seenModel = '';
    const r = await runDelegateCli([], {}, async () => 'piped prompt', {
      chat: async (model) => { seenModel = model; return { content: 'ok' }; },
    });
    expect(seenModel).toBe(DEFAULT_DELEGATE_MODEL);
    expect(r.stdout).toBe('ok');
  });

  it('errors (code 2) when there is no prompt', async () => {
    const r = await runDelegateCli([], {}, noStdin, { chat: async () => ({ content: 'x' }) });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no prompt');
  });

  it('reports a model failure as code 1', async () => {
    const r = await runDelegateCli(['hi'], {}, noStdin, {
      chat: async () => { throw new Error('gateway down'); },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('gateway down');
  });
});

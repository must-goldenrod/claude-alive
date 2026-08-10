import { describe, it, expect } from 'vitest';
import { runDelegateCli, resolveDelegateModel, DEFAULT_DELEGATE_MODEL } from '../delegateCli.js';

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

  it('logs a delegation record when CA_TICKET_ID is set', async () => {
    let logged = '';
    await runDelegateCli(['--model', 'gemini/x', 'do a thing'], { CA_TICKET_ID: 'T7' }, noStdin, {
      chat: async () => ({ content: 'ok', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }),
      appendLog: (line) => { logged = line; },
    });
    const rec = JSON.parse(logged);
    expect(rec).toMatchObject({ ticketId: 'T7', model: 'gemini/x', inputTokens: 10, outputTokens: 5, totalTokens: 15, promptPreview: 'do a thing' });
  });

  it('does NOT log when CA_TICKET_ID is absent (e.g. verifier run)', async () => {
    let logged = false;
    await runDelegateCli(['hi'], {}, noStdin, {
      chat: async () => ({ content: 'ok' }),
      appendLog: () => { logged = true; },
    });
    expect(logged).toBe(false);
  });

  // The gateway retires model ids; the pinned default went 400 "Invalid model
  // name" and every delegation failed. CA_DELEGATE_MODEL fixes that without a
  // rebuild, so it must reach the actual call.
  it('uses CA_DELEGATE_MODEL over the compiled-in default', async () => {
    let seenModel = '';
    await runDelegateCli([], { CA_DELEGATE_MODEL: 'glm-5.2' }, async () => 'hi', {
      chat: async (model) => { seenModel = model; return { content: 'ok' }; },
    });
    expect(seenModel).toBe('glm-5.2');
  });

  it('still lets an explicit --model win over CA_DELEGATE_MODEL', async () => {
    let seenModel = '';
    await runDelegateCli(['--model', 'kimi-k3', 'hi'], { CA_DELEGATE_MODEL: 'glm-5.2' }, noStdin, {
      chat: async (model) => { seenModel = model; return { content: 'ok' }; },
    });
    expect(seenModel).toBe('kimi-k3');
  });
});

describe('resolveDelegateModel', () => {
  it('falls back to the default when the override is unset or blank', () => {
    expect(resolveDelegateModel({})).toBe(DEFAULT_DELEGATE_MODEL);
    expect(resolveDelegateModel({ CA_DELEGATE_MODEL: '   ' })).toBe(DEFAULT_DELEGATE_MODEL);
  });

  it('trims the override', () => {
    expect(resolveDelegateModel({ CA_DELEGATE_MODEL: ' glm-5.2 ' })).toBe('glm-5.2');
  });
});

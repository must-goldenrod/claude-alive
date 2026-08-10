import { describe, it, expect } from 'vitest';
import { runDelegateCli, resolveDelegateModel, DEFAULT_DELEGATE_MODEL, orderChainByCooldown } from '../delegateCli.js';
import { LitellmHttpError } from '../litellmClient.js';
import type { CooldownStore } from '../modelCooldown.js';

const noStdin = async () => '';

/** Tests must never read the real ~/.claude-alive cooldown file. */
const noCooldowns: CooldownStore = { read: () => ({}), record: () => {} };

function memoryCooldowns(initial: Record<string, number> = {}): CooldownStore & { recorded: Record<string, number> } {
  const recorded: Record<string, number> = {};
  return {
    recorded,
    read: () => initial,
    record: (model, ms) => {
      recorded[model] = ms;
    },
  };
}

const rateLimited = () =>
  new LitellmHttpError(429, 'litellm.RateLimitError: 5-hour usage limit reached. Resets in 50min.');

describe('runDelegateCli', () => {
  it('delegates the prompt arg to the model and prints the answer', async () => {
    let seen: { model: string; prompt: string } | null = null;
    const r = await runDelegateCli(
      ['--model', 'gemini/x', 'summarize', 'this'],
      {},
      noStdin,
      { cooldowns: noCooldowns, chat: async (model, prompt) => { seen = { model, prompt }; return { content: 'ANSWER', usage: { totalTokens: 9 } }; } },
    );
    expect(seen).toEqual({ model: 'gemini/x', prompt: 'summarize this' });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('ANSWER');
    expect(r.stderr).toContain('"totalTokens":9');
  });

  it('falls back to stdin when no prompt arg is given, with the default model', async () => {
    let seenModel = '';
    const r = await runDelegateCli([], {}, async () => 'piped prompt', {
      cooldowns: noCooldowns,
      chat: async (model) => { seenModel = model; return { content: 'ok' }; },
    });
    expect(seenModel).toBe(DEFAULT_DELEGATE_MODEL);
    expect(r.stdout).toBe('ok');
  });

  it('errors (code 2) when there is no prompt', async () => {
    const r = await runDelegateCli([], {}, noStdin, { cooldowns: noCooldowns, chat: async () => ({ content: 'x' }) });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no prompt');
  });

  it('reports a model failure as code 1', async () => {
    const r = await runDelegateCli(['hi'], {}, noStdin, {
      cooldowns: noCooldowns,
      chat: async () => { throw new Error('gateway down'); },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('gateway down');
  });

  it('logs a delegation record when CA_TICKET_ID is set', async () => {
    let logged = '';
    await runDelegateCli(['--model', 'gemini/x', 'do a thing'], { CA_TICKET_ID: 'T7' }, noStdin, {
      cooldowns: noCooldowns,
      chat: async () => ({ content: 'ok', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }),
      appendLog: (line) => { logged = line; },
    });
    const rec = JSON.parse(logged);
    expect(rec).toMatchObject({ ticketId: 'T7', model: 'gemini/x', inputTokens: 10, outputTokens: 5, totalTokens: 15, promptPreview: 'do a thing' });
    expect(rec.requestedModel).toBeUndefined();
  });

  it('does NOT log when CA_TICKET_ID is absent (e.g. verifier run)', async () => {
    let logged = false;
    await runDelegateCli(['hi'], {}, noStdin, {
      cooldowns: noCooldowns,
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
      cooldowns: noCooldowns,
      chat: async (model) => { seenModel = model; return { content: 'ok' }; },
    });
    expect(seenModel).toBe('glm-5.2');
  });

  it('still lets an explicit --model win over CA_DELEGATE_MODEL', async () => {
    let seenModel = '';
    await runDelegateCli(['--model', 'kimi-k3', 'hi'], { CA_DELEGATE_MODEL: 'glm-5.2' }, noStdin, {
      cooldowns: noCooldowns,
      chat: async (model) => { seenModel = model; return { content: 'ok' }; },
    });
    expect(seenModel).toBe('kimi-k3');
  });

  it('resolves a short alias to the gateway id', async () => {
    let seenModel = '';
    await runDelegateCli(['--model', 'grok', 'hi'], {}, noStdin, {
      cooldowns: noCooldowns,
      chat: async (model) => { seenModel = model; return { content: 'ok' }; },
    });
    expect(seenModel).toBe('grok-4.5');
  });
});

describe('runDelegateCli fallback', () => {
  it('moves to the next model when the first is rate-limited, and remembers the window', async () => {
    const cooldowns = memoryCooldowns();
    const tried: string[] = [];
    const r = await runDelegateCli(['--model', 'kimi', 'hi'], { CA_TICKET_ID: 'T1' }, noStdin, {
      cooldowns,
      chat: async (model) => {
        tried.push(model);
        if (model === 'kimi-k3' || model === 'kimi-k3-go2') throw rateLimited();
        return { content: 'from the peer' };
      },
      appendLog: () => {},
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('from the peer');
    expect(tried).toEqual(['kimi-k3', 'kimi-k3-go2', 'kimi-k2.7-code']);
    expect(cooldowns.recorded).toEqual({ 'kimi-k3': 50 * 60_000, 'kimi-k3-go2': 50 * 60_000 });
    expect(JSON.parse(r.stderr)).toMatchObject({ model: 'kimi-k2.7-code' });
    expect(JSON.parse(r.stderr).attempts).toHaveLength(2);
  });

  it('records the substitution on the ticket so it is not silent', async () => {
    let logged = '';
    await runDelegateCli(['--model', 'kimi', 'hi'], { CA_TICKET_ID: 'T2' }, noStdin, {
      cooldowns: memoryCooldowns(),
      chat: async (model) => {
        if (model === 'kimi-k3') throw rateLimited();
        return { content: 'ok' };
      },
      appendLog: (line) => { logged = line; },
    });
    expect(JSON.parse(logged)).toMatchObject({ model: 'kimi-k3-go2', requestedModel: 'kimi-k3' });
  });

  it('skips a model already known to be cooling, without calling it', async () => {
    const tried: string[] = [];
    const r = await runDelegateCli(['--model', 'kimi', 'hi'], {}, noStdin, {
      now: () => 1_000,
      cooldowns: memoryCooldowns({ 'kimi-k3': 999_999, 'kimi-k3-go2': 999_999 }),
      chat: async (model) => { tried.push(model); return { content: 'ok' }; },
    });
    expect(tried).toEqual(['kimi-k2.7-code']);
    expect(JSON.parse(r.stderr).skippedCooling).toEqual(['kimi-k3', 'kimi-k3-go2']);
  });

  // Cross-model verification is worthless if the answer silently comes from
  // somewhere else, so --no-fallback must fail rather than substitute.
  it('does not substitute under --no-fallback', async () => {
    const tried: string[] = [];
    const r = await runDelegateCli(['--model', 'grok', '--no-fallback', 'hi'], {}, noStdin, {
      cooldowns: memoryCooldowns(),
      chat: async (model) => { tried.push(model); throw rateLimited(); },
    });
    expect(tried).toEqual(['grok-4.5']);
    expect(r.code).toBe(1);
  });

  it('tries an explicit chain in the order given', async () => {
    const tried: string[] = [];
    await runDelegateCli(['--model', 'grok,kimi,glm', 'hi'], {}, noStdin, {
      cooldowns: memoryCooldowns(),
      chat: async (model) => {
        tried.push(model);
        if (model !== 'glm-5.2') throw rateLimited();
        return { content: 'ok' };
      },
    });
    expect(tried).toEqual(['grok-4.5', 'kimi-k3', 'glm-5.2']);
  });

  it('stops immediately on an auth failure instead of walking the chain', async () => {
    const tried: string[] = [];
    const r = await runDelegateCli(['--model', 'kimi', 'hi'], {}, noStdin, {
      cooldowns: memoryCooldowns(),
      chat: async (model) => { tried.push(model); throw new LitellmHttpError(401, 'invalid api key'); },
    });
    expect(tried).toEqual(['kimi-k3']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('401');
  });

  it('lists the catalogue with live cooldown state and needs no prompt', async () => {
    const r = await runDelegateCli(['--list-models'], {}, noStdin, {
      now: () => 0,
      cooldowns: memoryCooldowns({ 'kimi-k3': 10 * 60_000 }),
      chat: async () => { throw new Error('must not be called'); },
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('kimi-k3\tkimi,k3\tcode\tcooling 10m');
    expect(r.stdout).toContain('grok-4.5\tgrok\treasoning\tready');
  });
});

describe('orderChainByCooldown', () => {
  it('drops cooling models while any peer is ready', () => {
    expect(orderChainByCooldown(['a', 'b', 'c'], { b: 500 }, 100)).toEqual({ order: ['a', 'c'], skipped: ['b'] });
  });

  // Four guaranteed 429s are not worth the wall-clock; the stored window is only
  // a hint, so the one closest to recovery still gets a try.
  it('tries only the soonest-recovering model when everything is cooling', () => {
    expect(orderChainByCooldown(['a', 'b'], { a: 900, b: 300 }, 100)).toEqual({ order: ['b'], skipped: ['a'] });
  });

  it('passes an all-ready chain through untouched', () => {
    expect(orderChainByCooldown(['a', 'b'], {}, 100)).toEqual({ order: ['a', 'b'], skipped: [] });
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

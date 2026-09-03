import { describe, it, expect } from 'vitest';
import {
  createLitellmPanel,
  seatChain,
  dedupeByRespondedModel,
  extractJsonObject,
  readString,
  resolvePanelModels,
  DEFAULT_PANEL_MODELS,
} from '../panel/litellmPanel.js';
import type { LitellmClient } from '../orchestrator/litellmClient.js';

function stubClient(answers: Record<string, string | Error>): LitellmClient {
  return {
    checkConnection: async () => ({ ok: true, models: Object.keys(answers) }),
    chat: async (model) => {
      const a = answers[model];
      if (a instanceof Error) throw a;
      return { content: a ?? '', model };
    },
  };
}

describe('extractJsonObject', () => {
  it('parses a bare object', () => {
    expect(extractJsonObject('{"passed":true}')).toEqual({ passed: true });
  });
  it('parses a fenced object', () => {
    expect(extractJsonObject('```json\n{"passed":false,"reason":"no"}\n```')).toEqual({ passed: false, reason: 'no' });
  });
  it('prefers the LAST object when the model explains itself first', () => {
    const text = 'Example of the shape: {"passed": true}\nMy actual answer:\n{"passed": false, "reason": "goal unmet"}';
    expect(extractJsonObject(text)).toEqual({ passed: false, reason: 'goal unmet' });
  });
  it('handles nested objects', () => {
    expect(extractJsonObject('prefix {"a":{"b":1}} suffix')).toEqual({ a: { b: 1 } });
  });
  it('returns null for null, prose, and arrays', () => {
    expect(extractJsonObject(null)).toBeNull();
    expect(extractJsonObject('no json at all')).toBeNull();
    expect(extractJsonObject('[1,2,3]')).toBeNull();
  });
});

describe('readString', () => {
  it('trims and rejects blank / non-string values', () => {
    expect(readString({ a: '  x  ' }, 'a')).toBe('x');
    expect(readString({ a: '   ' }, 'a')).toBeNull();
    expect(readString({ a: 3 }, 'a')).toBeNull();
    expect(readString({}, 'a')).toBeNull();
  });
});

describe('resolvePanelModels', () => {
  it('defaults when unset or blank', () => {
    expect(resolvePanelModels({})).toEqual(DEFAULT_PANEL_MODELS);
    expect(resolvePanelModels({ CA_PANEL_MODELS: '  ' })).toEqual(DEFAULT_PANEL_MODELS);
  });
  it('splits and trims an override', () => {
    expect(resolvePanelModels({ CA_PANEL_MODELS: 'a, b ,c' })).toEqual(['a', 'b', 'c']);
  });
});

describe('createLitellmPanel', () => {
  it('asks every roster model and returns each answer', async () => {
    const panel = createLitellmPanel(stubClient({ a: 'A says', b: 'B says' }), { models: ['a', 'b'] });
    const out = await panel.run({ system: 's', user: 'u' });
    expect(out.map((m) => m.content)).toEqual(['A says', 'B says']);
  });

  it('isolates a failing member instead of failing the panel', async () => {
    const panel = createLitellmPanel(stubClient({ a: 'ok', b: new Error('429 rate limited') }), { models: ['a', 'b'], fallbacks: false });
    const out = await panel.run({ system: 's', user: 'u' });
    expect(out[0]).toMatchObject({ model: 'a', content: 'ok' });
    expect(out[1]).toMatchObject({ model: 'b', content: null, error: '429 rate limited' });
  });

  it('treats an empty answer as no answer', async () => {
    const panel = createLitellmPanel(stubClient({ a: '   ' }), { models: ['a'], fallbacks: false });
    const [m] = await panel.run({ system: 's', user: 'u' });
    expect(m).toMatchObject({ content: null, error: 'empty answer' });
  });

  it('runs members in parallel, not one after another', async () => {
    let live = 0;
    let peak = 0;
    const client: LitellmClient = {
      checkConnection: async () => ({ ok: true }),
      chat: async (model) => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live -= 1;
        return { content: model, model };
      },
    };
    await createLitellmPanel(client, { models: ['a', 'b', 'c'], fallbacks: false }).run({ system: 's', user: 'u' });
    expect(peak).toBe(3);
  });
});

describe('seatChain', () => {
  it('gives a known model its own fallbacks', () => {
    const chain = seatChain('grok-4.5', ['grok-4.5']);
    expect(chain[0]).toBe('grok-4.5');
    expect(chain.length).toBeGreaterThan(1);
  });

  it('never falls back onto another seat\'s model', () => {
    const roster = ['grok-4.5', 'kimi-k3', 'gemini/gemini-3.1-pro-preview'];
    for (const m of roster) {
      const rest = roster.filter((x) => x !== m);
      expect(seatChain(m, roster).filter((id) => rest.includes(id))).toEqual([]);
    }
  });

  it('always keeps at least the requested model', () => {
    expect(seatChain('some-unknown-model', ['some-unknown-model'])[0]).toBe('some-unknown-model');
  });
});

describe('dedupeByRespondedModel', () => {
  it('keeps the first vote from a model and drops later duplicates', () => {
    const out = dedupeByRespondedModel([
      { model: 'a', respondedModel: 'x', content: 'first' },
      { model: 'b', respondedModel: 'x', content: 'second' },
    ]);
    expect(out[0]!.content).toBe('first');
    expect(out[1]!.content).toBeNull();
    expect(out[1]!.error).toContain('duplicate model');
  });

  it('leaves distinct models and existing abstentions alone', () => {
    const out = dedupeByRespondedModel([
      { model: 'a', respondedModel: 'x', content: 'one' },
      { model: 'b', respondedModel: 'y', content: 'two' },
      { model: 'c', content: null, error: 'timeout' },
    ]);
    expect(out.map((m) => m.content)).toEqual(['one', 'two', null]);
  });
});

describe('panel fallbacks', () => {
  it('fails a rate-limited seat over to the next model so the seat still votes', async () => {
    const calls: string[] = [];
    const client: LitellmClient = {
      checkConnection: async () => ({ ok: true }),
      chat: async (model) => {
        calls.push(model);
        if (model === 'grok-4.5') throw new Error('HTTP 429');
        return { content: 'answer', model };
      },
    };
    const [seat] = await createLitellmPanel(client, { models: ['grok-4.5'] }).run({ system: 's', user: 'u' });
    expect(seat!.content).toBe('answer');
    expect(seat!.model).toBe('grok-4.5');
    expect(seat!.respondedModel).not.toBe('grok-4.5');
    expect(calls[0]).toBe('grok-4.5');
  });

  it('abstains with the last error when the whole chain is exhausted', async () => {
    const client: LitellmClient = {
      checkConnection: async () => ({ ok: true }),
      chat: async () => {
        throw new Error('HTTP 429');
      },
    };
    const [seat] = await createLitellmPanel(client, { models: ['grok-4.5'] }).run({ system: 's', user: 'u' });
    expect(seat).toMatchObject({ content: null, error: 'HTTP 429' });
  });
});

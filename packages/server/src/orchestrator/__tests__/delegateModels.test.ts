import { describe, it, expect } from 'vitest';
import {
  DELEGATE_MODELS,
  DEFAULT_FALLBACK_TAIL,
  buildDelegateChain,
  describeDelegateModels,
  findDelegateModel,
  resolveModelId,
} from '../delegateModels.js';

describe('catalogue integrity', () => {
  it('has unique ids and aliases', () => {
    const ids = DELEGATE_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const aliases = DELEGATE_MODELS.flatMap((m) => m.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  // A fallback pointing at an id the gateway does not serve would turn one
  // failure into two, so every hop must name a catalogue entry.
  it('only falls back to models that exist in the catalogue', () => {
    const ids = new Set(DELEGATE_MODELS.map((m) => m.id));
    for (const m of DELEGATE_MODELS) {
      for (const f of m.fallbacks) expect(ids.has(f), `${m.id} → ${f}`).toBe(true);
    }
    for (const f of DEFAULT_FALLBACK_TAIL) expect(ids.has(f)).toBe(true);
  });

  it('never lists a model as its own fallback', () => {
    for (const m of DELEGATE_MODELS) expect(m.fallbacks).not.toContain(m.id);
  });
});

describe('findDelegateModel / resolveModelId', () => {
  it('matches by id and by alias, case-insensitively', () => {
    expect(findDelegateModel('kimi')?.id).toBe('kimi-k3');
    expect(findDelegateModel('KIMI-K3')?.id).toBe('kimi-k3');
    expect(findDelegateModel(' grok ')?.id).toBe('grok-4.5');
  });

  it('passes an unknown id through (the gateway catalogue rotates)', () => {
    expect(findDelegateModel('brand/new-model')).toBeUndefined();
    expect(resolveModelId('brand/new-model')).toBe('brand/new-model');
  });
});

describe('buildDelegateChain', () => {
  it('appends the catalogue fallbacks to a known model', () => {
    expect(buildDelegateChain('kimi')).toEqual(['kimi-k3', ...DELEGATE_MODELS.find((m) => m.id === 'kimi-k3')!.fallbacks]);
  });

  it('gives an unknown model the cross-vendor default tail', () => {
    expect(buildDelegateChain('brand/new')).toEqual(['brand/new', ...DEFAULT_FALLBACK_TAIL]);
  });

  it('takes an explicit multi-model chain literally', () => {
    expect(buildDelegateChain('grok, kimi ,glm')).toEqual(['grok-4.5', 'kimi-k3', 'glm-5.2']);
  });

  it('pins to one model under --no-fallback', () => {
    expect(buildDelegateChain('grok', { noFallback: true })).toEqual(['grok-4.5']);
  });

  it('lets CA_DELEGATE_FALLBACKS replace the tail', () => {
    expect(buildDelegateChain('kimi', { fallbackOverride: 'glm, flash' })).toEqual([
      'kimi-k3',
      'glm-5.2',
      'gemini/gemini-3.6-flash',
    ]);
  });

  it('dedupes when the override repeats the primary', () => {
    expect(buildDelegateChain('glm', { fallbackOverride: 'glm-5.2, grok' })).toEqual(['glm-5.2', 'grok-4.5']);
  });

  it('returns nothing for an empty request', () => {
    expect(buildDelegateChain('   ')).toEqual([]);
  });
});

describe('describeDelegateModels', () => {
  it('lists every model with its primary alias', () => {
    const text = describeDelegateModels();
    expect(text.split('\n')).toHaveLength(DELEGATE_MODELS.length);
    expect(text).toContain('kimi (kimi-k3)');
    expect(text).toContain('grok (grok-4.5)');
  });
});

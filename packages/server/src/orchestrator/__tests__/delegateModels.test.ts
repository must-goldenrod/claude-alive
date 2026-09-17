import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import {
  DELEGATE_MODELS,
  DEFAULT_FALLBACK_TAIL,
  buildDelegateChain,
  describeDelegateModels,
  findDelegateModel,
  resolveModelId,
  parseDelegateCatalog,
  loadDelegateCatalog,
  BUILTIN_DELEGATE_MODELS,
  reloadDelegateCatalog,
  ACTIVE_DELEGATE_CATALOG,
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
    expect(buildDelegateChain('grok, kimi ,glm')).toEqual(['grok-4.5', 'kimi-k3', 'glm-5.3']);
  });

  it('pins to one model under --no-fallback', () => {
    expect(buildDelegateChain('grok', { noFallback: true })).toEqual(['grok-4.5']);
  });

  it('lets CA_DELEGATE_FALLBACKS replace the tail', () => {
    expect(buildDelegateChain('kimi', { fallbackOverride: 'glm, flash' })).toEqual([
      'kimi-k3',
      'glm-5.3',
      'gemini/gemini-3.7-flash',
    ]);
  });

  it('dedupes when the override repeats the primary', () => {
    expect(buildDelegateChain('glm', { fallbackOverride: 'glm, grok' })).toEqual(['glm-5.3', 'grok-4.5']);
  });

  it('returns nothing for an empty request', () => {
    expect(buildDelegateChain('   ')).toEqual([]);
  });
});

describe('gateway alignment', () => {
  // The gateway's catalogue rotates; these are the ids probed live on
  // 2026-09-08. A retired id here means a delegation spends an attempt on a
  // model the gateway answers 400 for, so the table must track the gateway.
  const GATEWAY_IDS = [
    'gemini/gemini-3.7-flash',
    'gemini/gemini-3.6-flash',
    'gemini/gemini-3.5-flash',
    'gemini/gemini-3.5-flash-lite',
    'gemini/gemini-3.1-pro-preview',
    'glm-5.3',
    'glm-5.3-flash',
    'glm-5.2',
    'grok-4.5',
    'kimi-k3',
    'kimi-k3-go2',
    'kimi-k2.7-code',
    'gemma4',
  ];

  it('names only ids the gateway serves', () => {
    const served = new Set(GATEWAY_IDS);
    for (const m of DELEGATE_MODELS) expect(served.has(m.id), m.id).toBe(true);
  });

  it('keeps a newest-first entry for every family', () => {
    const ids = DELEGATE_MODELS.map((m) => m.id);
    for (const newest of ['gemini/gemini-3.7-flash', 'glm-5.3', 'kimi-k3', 'grok-4.5']) {
      expect(ids).toContain(newest);
    }
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

describe('user catalogue (models.json)', () => {
  const file = JSON.stringify({
    defaultModel: 'gpt-mini',
    panelModels: ['a', 'b', 'c'],
    models: [
      { id: 'gpt-mini', aliases: ['mini'], kind: 'fast', note: 'cheap', fallbacks: ['gpt-big', 'gpt-mini'] },
      { id: 'gpt-big', kind: 'nonsense' },
    ],
  });

  it('parses a valid file, drops self-fallbacks and defaults unknown kinds', () => {
    const c = parseDelegateCatalog(JSON.parse(file), '/x/models.json');
    if ('error' in c) throw new Error(c.error);
    expect(c.models.map((m) => m.id)).toEqual(['gpt-mini', 'gpt-big']);
    expect(c.models[0]!.fallbacks).toEqual(['gpt-big']);
    expect(c.models[1]!.kind).toBe('utility');
    expect(c.defaultModel).toBe('gpt-mini');
    expect(c.panelModels).toEqual(['a', 'b', 'c']);
    expect(c.fallbackTail).toEqual(['gpt-mini', 'gpt-big']);
  });

  it('rejects a file without models', () => {
    expect(parseDelegateCatalog({ models: [] }, 'f')).toHaveProperty('error');
    expect(parseDelegateCatalog([], 'f')).toHaveProperty('error');
    expect(parseDelegateCatalog({ models: [{ aliases: ['x'] }] }, 'f')).toHaveProperty('error');
  });

  it('loads the file named by CA_DELEGATE_MODELS_FILE', () => {
    const c = loadDelegateCatalog({ CA_DELEGATE_MODELS_FILE: '/x/models.json' }, () => file);
    expect(c.source).toBe('/x/models.json');
    expect(c.models).toHaveLength(2);
  });

  it('falls back to the built-in preset when the file is missing, broken, or pinned', () => {
    const missing = loadDelegateCatalog({}, () => {
      throw new Error('ENOENT');
    });
    expect(missing.source).toBe('builtin');
    const broken = loadDelegateCatalog({ CA_DELEGATE_MODELS_FILE: '/x' }, () => '{not json');
    expect(broken.models).toBe(BUILTIN_DELEGATE_MODELS);
    expect(loadDelegateCatalog({ CA_DELEGATE_MODELS_FILE: 'builtin' }, () => file).source).toBe('builtin');
  });
});

describe('reloadDelegateCatalog', () => {
  it('swaps the live catalogue seen by importers and lookups', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ca-models-'));
    const file = join(dir, 'models.json');
    writeFileSync(file, JSON.stringify({ defaultModel: 'live-a', models: [{ id: 'live-a', aliases: ['la'] }] }));
    try {
      reloadDelegateCatalog({ CA_DELEGATE_MODELS_FILE: file });
      expect(ACTIVE_DELEGATE_CATALOG.source).toBe(file);
      expect(ACTIVE_DELEGATE_CATALOG.defaultModel).toBe('live-a');
      expect(DELEGATE_MODELS.map((m) => m.id)).toEqual(['live-a']);
      expect(resolveModelId('la')).toBe('live-a');
    } finally {
      reloadDelegateCatalog({ CA_DELEGATE_MODELS_FILE: 'builtin' });
      rmSync(dir, { recursive: true, force: true });
    }
    expect(DELEGATE_MODELS).toBe(BUILTIN_DELEGATE_MODELS);
  });
});

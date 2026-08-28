import { describe, it, expect } from 'vitest';
import {
  parseFlagSupport,
  applyFlagSupport,
  isUnsupportedFlagError,
  createFlagSupportCache,
  NO_FLAG_SUPPORT,
} from '../agentFlags.js';

const HELP_NEW = `Options:
  --effort <level>       Effort level for the current session (low, medium, high, xhigh, max)
  --fallback-model <model>  Enable automatic fallback
  --model <model>        Model for the current session
  --verbose              Override verbose mode`;

const HELP_OLD = `Options:
  --fallback-model <model>  Enable automatic fallback
  --verbose              Override verbose mode`;

describe('parseFlagSupport', () => {
  it('detects both flags on a current CLI', () => {
    expect(parseFlagSupport(HELP_NEW)).toEqual({ model: true, effort: true });
  });

  it('reports no support on an older CLI', () => {
    expect(parseFlagSupport(HELP_OLD)).toEqual({ model: false, effort: false });
  });

  it('does not accept --fallback-model as evidence of --model', () => {
    expect(parseFlagSupport('  --fallback-model <model>  fallback only').model).toBe(false);
  });

  it('treats empty output as no support', () => {
    expect(parseFlagSupport('')).toEqual({ model: false, effort: false });
  });
});

describe('applyFlagSupport', () => {
  it('passes flags the target supports', () => {
    const r = applyFlagSupport({ model: 'opus', effort: 'max' }, { model: true, effort: true });
    expect(r).toEqual({ model: 'opus', effort: 'max', dropped: [] });
  });

  it('drops only the unsupported flag and reports it', () => {
    const r = applyFlagSupport({ model: 'opus', effort: 'max' }, { model: true, effort: false });
    expect(r.model).toBe('opus');
    expect(r.effort).toBeUndefined();
    expect(r.dropped).toEqual(['--effort']);
  });

  it('drops everything when the target supports nothing', () => {
    const r = applyFlagSupport({ model: 'opus', effort: 'max' }, NO_FLAG_SUPPORT);
    expect(r.model).toBeUndefined();
    expect(r.effort).toBeUndefined();
    expect(r.dropped).toEqual(['--model', '--effort']);
  });
});

describe('isUnsupportedFlagError', () => {
  it('recognises a commander usage error', () => {
    expect(isUnsupportedFlagError("error: unknown option '--effort'")).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isUnsupportedFlagError('fatal: not a git repository')).toBe(false);
  });
});

describe('createFlagSupportCache', () => {
  it('probes once per key and reuses the answer', async () => {
    const cache = createFlagSupportCache();
    let calls = 0;
    const probe = async () => {
      calls++;
      return HELP_NEW;
    };
    expect(await cache.ensure('local', probe)).toEqual({ model: true, effort: true });
    expect(await cache.ensure('local', probe)).toEqual({ model: true, effort: true });
    expect(calls).toBe(1);
  });

  it('shares one in-flight probe between concurrent callers', async () => {
    const cache = createFlagSupportCache();
    let calls = 0;
    const probe = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return HELP_NEW;
    };
    await Promise.all([cache.ensure('k', probe), cache.ensure('k', probe), cache.ensure('k', probe)]);
    expect(calls).toBe(1);
  });

  it('degrades to no-support when the probe fails, never rejecting', async () => {
    const cache = createFlagSupportCache();
    const support = await cache.ensure('broken', () => Promise.reject(new Error('ENOENT: claude')));
    expect(support).toEqual(NO_FLAG_SUPPORT);
  });

  it('re-probes after invalidate', async () => {
    const cache = createFlagSupportCache();
    let calls = 0;
    const probe = async () => {
      calls++;
      return HELP_NEW;
    };
    await cache.ensure('k', probe);
    cache.invalidate('k');
    await cache.ensure('k', probe);
    expect(calls).toBe(2);
  });

  it('keys targets separately', async () => {
    const cache = createFlagSupportCache();
    await cache.ensure('local', async () => HELP_NEW);
    await cache.ensure('ssh:host:22', async () => HELP_OLD);
    expect(cache.get('local')).toEqual({ model: true, effort: true });
    expect(cache.get('ssh:host:22')).toEqual({ model: false, effort: false });
  });
});

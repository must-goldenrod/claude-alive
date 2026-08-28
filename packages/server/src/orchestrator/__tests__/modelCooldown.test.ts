import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCooldownStore, parseCooldownMs, DEFAULT_COOLDOWN_MS } from '../modelCooldown.js';

const dirs: string[] = [];
function tmpFile(): string {
  const d = mkdtempSync(join(tmpdir(), 'ca-cooldown-'));
  dirs.push(d);
  return join(d, 'delegate-cooldowns.json');
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('parseCooldownMs', () => {
  // The real gateway 429: "5-hour usage limit reached. Resets in 50min."
  it('reads the reset window out of the provider prose', () => {
    expect(parseCooldownMs('RateLimitError: 5-hour usage limit reached. Resets in 50min.')).toBe(50 * 60_000);
    expect(parseCooldownMs('Resets in 1h 5min')).toBe(65 * 60_000);
  });

  it('prefers a retry-after header when the gateway sends one', () => {
    expect(parseCooldownMs('Resets in 50min.', '600')).toBe(600_000);
  });

  it('falls back to a default for an unreadable 429', () => {
    expect(parseCooldownMs('too many requests')).toBe(DEFAULT_COOLDOWN_MS);
  });

  it('clamps absurd windows into [1min, 6h]', () => {
    expect(parseCooldownMs('Resets in 5s')).toBe(60_000);
    expect(parseCooldownMs('Resets in 40h')).toBe(6 * 60 * 60_000);
  });
});

describe('createCooldownStore', () => {
  it('round-trips a recorded cooldown', () => {
    const path = tmpFile();
    const store = createCooldownStore(path, () => 1_000_000);
    store.record('kimi-k3', 10 * 60_000);
    expect(createCooldownStore(path, () => 1_000_000).read()).toEqual({ 'kimi-k3': 1_000_000 + 600_000 });
  });

  it('hides and prunes entries whose window has passed', () => {
    const path = tmpFile();
    createCooldownStore(path, () => 0).record('grok-4.5', 60_000);
    expect(createCooldownStore(path, () => 5_000_000).read()).toEqual({});
    createCooldownStore(path, () => 5_000_000).record('kimi-k3', 60_000);
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf-8')))).toEqual(['kimi-k3']);
  });

  it('treats a missing or corrupt file as "nothing is cooling"', () => {
    const path = tmpFile();
    expect(createCooldownStore(path).read()).toEqual({});
    writeFileSync(path, '{ not json');
    expect(createCooldownStore(path).read()).toEqual({});
    writeFileSync(path, '["array"]');
    expect(createCooldownStore(path).read()).toEqual({});
  });

  it('never throws when the file cannot be written', () => {
    const store = createCooldownStore('/proc/nonexistent-dir/cooldowns.json', () => 0);
    expect(() => store.record('glm-5.2', 60_000)).not.toThrow();
  });
});

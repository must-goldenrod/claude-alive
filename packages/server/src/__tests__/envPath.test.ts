import { describe, it, expect } from 'vitest';
import { augmentPath } from '../envPath.js';

const HOME = '/home/tester';

describe('augmentPath', () => {
  it('prepends user bin dirs so claude (~/.local/bin) is resolvable', () => {
    const out = augmentPath('/usr/bin:/bin', HOME).split(':');
    expect(out).toContain(`${HOME}/.local/bin`);
    expect(out).toContain(`${HOME}/.npm-global/bin`);
    // user dirs come before the inherited system PATH
    expect(out.indexOf(`${HOME}/.local/bin`)).toBeLessThan(out.indexOf('/usr/bin'));
  });

  it('does not duplicate a dir already present in PATH', () => {
    const out = augmentPath(`${HOME}/.local/bin:/usr/bin`, HOME).split(':');
    expect(out.filter((p) => p === `${HOME}/.local/bin`)).toHaveLength(1);
  });

  it('preserves the order of the inherited PATH entries', () => {
    const out = augmentPath('/opt/x:/opt/y', HOME).split(':');
    expect(out.indexOf('/opt/x')).toBeLessThan(out.indexOf('/opt/y'));
  });

  it('falls back to a sane default when base PATH is empty/undefined', () => {
    const out = augmentPath(undefined, HOME).split(':');
    expect(out).toContain(`${HOME}/.local/bin`);
    expect(out).toContain('/usr/bin');
    expect(out).toContain('/bin');
  });
});

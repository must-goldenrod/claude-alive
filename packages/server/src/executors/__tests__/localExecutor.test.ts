import { describe, it, expect } from 'vitest';
import { createLocalExecutor } from '../localExecutor.js';

describe('createLocalExecutor.validateCwd', () => {
  it('rejects a missing cwd', async () => {
    const ex = createLocalExecutor({ cwdExists: () => false });
    expect(await ex.validateCwd('/nope')).toContain('does not exist');
  });

  it('accepts an existing cwd when no allowlist is set', async () => {
    const ex = createLocalExecutor({ cwdExists: () => true });
    expect(await ex.validateCwd('/anywhere')).toBeNull();
  });

  it('enforces the allowlist against the canonicalized path', async () => {
    const ex = createLocalExecutor({
      cwdExists: () => true,
      canonicalize: (p) => p,
      allowedRoots: ['/home/user'],
    });
    expect(await ex.validateCwd('/home/user/repo')).toBeNull();
    expect(await ex.validateCwd('/etc')).toContain('not in allowlist');
  });

  it('rejects a cwd that fails to canonicalize when an allowlist is set', async () => {
    const ex = createLocalExecutor({
      cwdExists: () => true,
      canonicalize: () => {
        throw new Error('no such path');
      },
      allowedRoots: ['/home/user'],
    });
    expect(await ex.validateCwd('/home/user/x')).toContain('does not resolve');
  });
});

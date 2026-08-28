import { describe, expect, it } from 'vitest';
import { repoIdFor, worktreeIdFor } from '../runs/repoId.js';

describe('repoIdFor', () => {
  it('is stable for the same root', () => {
    expect(repoIdFor('/Users/a/proj')).toBe(repoIdFor('/Users/a/proj'));
  });

  it('ignores a trailing slash', () => {
    expect(repoIdFor('/Users/a/proj/')).toBe(repoIdFor('/Users/a/proj'));
  });

  it('separates different roots', () => {
    expect(repoIdFor('/Users/a/proj')).not.toBe(repoIdFor('/Users/a/other'));
  });

  it('separates the same path on different hosts', () => {
    expect(repoIdFor('/srv/app', 'ssh:build@10.0.0.2')).not.toBe(repoIdFor('/srv/app'));
  });
});

describe('worktreeIdFor', () => {
  it('is stable and scoped to its repo', () => {
    const repo = repoIdFor('/Users/a/proj');
    expect(worktreeIdFor(repo, '/Users/a/proj')).toBe(worktreeIdFor(repo, '/Users/a/proj'));
    expect(worktreeIdFor(repo, '/Users/a/proj')).not.toBe(worktreeIdFor(repo, '/Users/a/wt-1'));
  });
});

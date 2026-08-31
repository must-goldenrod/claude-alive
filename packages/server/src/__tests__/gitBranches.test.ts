import { describe, expect, it, vi } from 'vitest';
import {
  branchNameError, createBranch, deleteBranch, listBranches, switchBranch,
} from '../gitBranches.js';

/** A fake git: maps a joined argv to its stdout, throwing for anything else. */
function fakeGit(table: Record<string, string>, log?: string[][]) {
  return async (args: string[]) => {
    log?.push(args);
    const key = args.join(' ');
    if (key in table) return table[key]!;
    throw new Error(`unexpected git ${key}`);
  };
}

const CLEAN = {
  'rev-parse --is-inside-work-tree': 'true',
  'rev-parse --abbrev-ref HEAD': 'main',
  'for-each-ref --format=%(refname:short) refs/heads': 'main\nfeat/x\nfix/y',
  'status --porcelain': '',
};

describe('branchNameError', () => {
  it('accepts ordinary names', () => {
    for (const name of ['main', 'feat/x', 'fix/issue-12', 'release_1.2']) {
      expect(branchNameError(name), name).toBeNull();
    }
  });

  it('rejects an empty or blank name', () => {
    expect(branchNameError('')).not.toBeNull();
    expect(branchNameError('   ')).not.toBeNull();
  });

  it('rejects whitespace inside the name', () => {
    expect(branchNameError('my branch')).not.toBeNull();
  });

  it('rejects git-reserved punctuation', () => {
    for (const name of ['a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'a..b', 'a@{b']) {
      expect(branchNameError(name), name).not.toBeNull();
    }
  });

  it('rejects names git itself would refuse at the edges', () => {
    for (const name of ['-lead', '/lead', 'trail/', 'trail.', 'trail.lock', 'a//b', '.hidden', 'a/.b']) {
      expect(branchNameError(name), name).not.toBeNull();
    }
  });

  it('rejects a name long enough to be a mistake', () => {
    expect(branchNameError('x'.repeat(256))).not.toBeNull();
  });
});

describe('listBranches', () => {
  it('reports the current branch, every local branch and cleanliness', async () => {
    const res = await listBranches('/r/proj', fakeGit(CLEAN));
    expect(res).toEqual({ current: 'main', branches: ['main', 'feat/x', 'fix/y'], dirty: false });
  });

  it('reports a dirty tree so callers can refuse to switch', async () => {
    const res = await listBranches('/r/proj', fakeGit({ ...CLEAN, 'status --porcelain': ' M src/a.ts' }));
    expect(res.dirty).toBe(true);
  });

  it('returns null outside a git repository rather than throwing', async () => {
    const git = async (args: string[]) => {
      if (args.join(' ') === 'rev-parse --is-inside-work-tree') throw new Error('not a repo');
      throw new Error('unreachable');
    };
    expect(await listBranches('/tmp/plain', git)).toBeNull();
  });
});

describe('switchBranch', () => {
  it('checks out an existing branch', async () => {
    const log: string[][] = [];
    const res = await switchBranch('/r/proj', 'feat/x', fakeGit({ ...CLEAN, 'checkout feat/x': '' }, log));
    expect(res).toEqual({ ok: true, branch: 'feat/x' });
    expect(log).toContainEqual(['checkout', 'feat/x']);
  });

  it('refuses to switch with uncommitted changes instead of dragging them across', async () => {
    const git = fakeGit({ ...CLEAN, 'status --porcelain': ' M src/a.ts' });
    const res = await switchBranch('/r/proj', 'feat/x', git);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('dirty');
  });

  it('refuses a branch that does not exist locally', async () => {
    const res = await switchBranch('/r/proj', 'nope', fakeGit(CLEAN));
    expect(res.ok).toBe(false);
  });

  it('is a no-op when already on that branch', async () => {
    const log: string[][] = [];
    const res = await switchBranch('/r/proj', 'main', fakeGit(CLEAN, log));
    expect(res).toEqual({ ok: true, branch: 'main' });
    expect(log.some((a) => a[0] === 'checkout')).toBe(false);
  });

  it('rejects an invalid name before running git at all', async () => {
    const git = vi.fn();
    const res = await switchBranch('/r/proj', 'a b', git);
    expect(res.ok).toBe(false);
    expect(git).not.toHaveBeenCalled();
  });
});

describe('createBranch', () => {
  it('creates and switches in one step', async () => {
    const log: string[][] = [];
    const git = fakeGit({ ...CLEAN, 'checkout -b feat/new': '' }, log);
    const res = await createBranch('/r/proj', 'feat/new', undefined, git);
    expect(res).toEqual({ ok: true, branch: 'feat/new' });
    expect(log).toContainEqual(['checkout', '-b', 'feat/new']);
  });

  it('branches from an explicit start point when given one', async () => {
    const log: string[][] = [];
    const git = fakeGit({ ...CLEAN, 'checkout -b feat/new main': '' }, log);
    await createBranch('/r/proj', 'feat/new', 'main', git);
    expect(log).toContainEqual(['checkout', '-b', 'feat/new', 'main']);
  });

  it('refuses a name that already exists locally', async () => {
    const res = await createBranch('/r/proj', 'feat/x', undefined, fakeGit(CLEAN));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('already-exists');
  });

  it('refuses an unknown start point', async () => {
    const res = await createBranch('/r/proj', 'feat/new', 'ghost', fakeGit(CLEAN));
    expect(res.ok).toBe(false);
  });

  it('refuses with uncommitted changes', async () => {
    const git = fakeGit({ ...CLEAN, 'status --porcelain': '?? new.ts' });
    expect((await createBranch('/r/proj', 'feat/new', undefined, git)).ok).toBe(false);
  });

  it('rejects an invalid name before running git at all', async () => {
    const git = vi.fn();
    expect((await createBranch('/r/proj', 'a~b', undefined, git)).ok).toBe(false);
    expect(git).not.toHaveBeenCalled();
  });
});

describe('deleteBranch', () => {
  it('deletes a merged branch with the safe flag', async () => {
    const log: string[][] = [];
    const git = fakeGit({ ...CLEAN, 'branch -d feat/x': 'Deleted branch feat/x' }, log);
    const res = await deleteBranch('/r/proj', 'feat/x', git);
    expect(res.ok).toBe(true);
    // -d, never -D: git refuses unmerged work and that refusal is the safeguard.
    expect(log).toContainEqual(['branch', '-d', 'feat/x']);
  });

  it('refuses to delete the branch that is checked out', async () => {
    const res = await deleteBranch('/r/proj', 'main', fakeGit(CLEAN));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('delete-current');
  });

  it('surfaces git own refusal for unmerged work', async () => {
    const git = async (args: string[]) => {
      const key = args.join(' ');
      if (key in CLEAN) return CLEAN[key as keyof typeof CLEAN];
      if (key === 'branch -d feat/x') throw new Error('error: the branch feat/x is not fully merged');
      throw new Error('unexpected');
    };
    const res = await deleteBranch('/r/proj', 'feat/x', git);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('git-failed');
    expect(res.message).toMatch(/not fully merged/);
  });

  it('refuses a branch that does not exist', async () => {
    expect((await deleteBranch('/r/proj', 'ghost', fakeGit(CLEAN))).ok).toBe(false);
  });
});

// Argv-flag smuggling. The guard is four deep — the HTTP schema, branchNameError,
// the "must already exist" check, and git's own refname rules — but only the
// second is enforced here, so it is pinned with its own tests: a later edit that
// drops it would otherwise pass everything else.
describe('argv flag smuggling', () => {
  it('never lets a dash-leading branch name reach git', async () => {
    for (const name of ['--orphan', '-b', '--force']) {
      const git = vi.fn();
      const created = await createBranch('/r/proj', name, undefined, git);
      const switched = await switchBranch('/r/proj', name, git);
      const deleted = await deleteBranch('/r/proj', name, git);
      expect(created.code, name).toBe('name-edges');
      expect(switched.code, name).toBe('name-edges');
      expect(deleted.code, name).toBe('name-edges');
      expect(git, name).not.toHaveBeenCalled();
    }
  });

  it('never lets a dash-leading start point reach git', async () => {
    const git = vi.fn();
    const res = await createBranch('/r/proj', 'feat/ok', '--orphan', git);
    expect(res.code).toBe('name-edges');
    expect(res.name).toBe('--orphan');
    expect(git).not.toHaveBeenCalled();
  });

  it('requires the start point to be a branch that already exists', async () => {
    // Even a validly-named start point cannot be an arbitrary string handed to git.
    const res = await createBranch('/r/proj', 'feat/ok', 'HEAD~5', fakeGit(CLEAN));
    expect(res.ok).toBe(false);
  });

  it('passes the start point as its own argv entry, never spliced into one', async () => {
    const log: string[][] = [];
    const git = fakeGit({ ...CLEAN, 'checkout -b feat/new main': '' }, log);
    await createBranch('/r/proj', 'feat/new', 'main', git);
    // No `--` here on purpose: in `git checkout -b <name> <start>` a `--`
    // separates pathspecs, so it would make git read the start point as a file
    // and fail with "not a commit". execFile (not a shell) already keeps each
    // entry a single argument.
    expect(log).toContainEqual(['checkout', '-b', 'feat/new', 'main']);
  });
});

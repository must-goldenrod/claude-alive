import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGitCache, resolveCwd, type GitExec } from '../gitResolver.js';

/** Fake git: answers toplevel/branch from a table, fails for unknown paths. */
function fakeGit(table: Record<string, { top: string; branch: string; gitDir?: string }>): GitExec {
  return vi.fn(async (args: string[], cwd: string) => {
    const entry = table[cwd];
    if (!entry) return null;
    if (args.includes('--show-toplevel')) return entry.top;
    if (args.includes('--abbrev-ref')) return entry.branch;
    if (args.includes('--absolute-git-dir')) return entry.gitDir ?? `${entry.top}/.git`;
    return null;
  });
}

beforeEach(() => clearGitCache());

describe('resolveCwd', () => {
  it('maps a subdirectory to its repository root', async () => {
    const exec = fakeGit({ '/r/proj/packages/ui': { top: '/r/proj', branch: 'main' } });
    const out = await resolveCwd('/r/proj/packages/ui', { exec });
    expect(out.repository.root).toBe('/r/proj');
    expect(out.repository.isGit).toBe(true);
    expect(out.worktree.branch).toBe('main');
    expect(out.worktree.isPrimary).toBe(true);
  });

  it('gives two subdirectories of one repo the same repoId', async () => {
    const exec = fakeGit({
      '/r/proj/a': { top: '/r/proj', branch: 'main' },
      '/r/proj/b': { top: '/r/proj', branch: 'main' },
    });
    const a = await resolveCwd('/r/proj/a', { exec });
    const b = await resolveCwd('/r/proj/b', { exec });
    expect(a.repository.repoId).toBe(b.repository.repoId);
    expect(a.worktree.worktreeId).toBe(b.worktree.worktreeId);
  });

  it('treats a separate worktree as a different worktree', async () => {
    const exec = fakeGit({
      '/r/proj': { top: '/r/proj', branch: 'main' },
      '/r/wt-feat': { top: '/r/wt-feat', branch: 'feat/x' },
    });
    const main = await resolveCwd('/r/proj', { exec });
    const wt = await resolveCwd('/r/wt-feat', { exec });
    expect(wt.worktree.worktreeId).not.toBe(main.worktree.worktreeId);
    expect(wt.worktree.branch).toBe('feat/x');
  });

  it('falls back to a non-git repository when git fails', async () => {
    const exec = fakeGit({});
    const out = await resolveCwd('/tmp/scratch', { exec });
    expect(out.repository.isGit).toBe(false);
    expect(out.repository.root).toBe('/tmp/scratch');
    expect(out.worktree.branch).toBe('');
  });

  it('caches so git runs once per cwd', async () => {
    const exec = fakeGit({ '/r/proj': { top: '/r/proj', branch: 'main' } });
    await resolveCwd('/r/proj', { exec });
    await resolveCwd('/r/proj', { exec });
    expect(exec).toHaveBeenCalledTimes(3); // toplevel + branch + git-dir, once each
  });

  it('re-reads once the cache entry has aged out, so a checkout is picked up', async () => {
    const exec = fakeGit({ '/r/proj': { top: '/r/proj', branch: 'main' } });
    let clock = 1_000;
    const now = () => clock;
    expect((await resolveCwd('/r/proj', { exec, now })).worktree.branch).toBe('main');
    clock += 60_000;
    await resolveCwd('/r/proj', { exec, now });
    expect(exec).toHaveBeenCalledTimes(6);
  });

  it('treats a linked worktree as not primary, whatever its branch is named', async () => {
    const exec = fakeGit({
      '/r/wt': { top: '/r/wt', branch: 'main', gitDir: '/r/proj/.git/worktrees/wt' },
    });
    expect((await resolveCwd('/r/wt', { exec })).worktree.isPrimary).toBe(false);
  });

  it('treats the main checkout as primary even on a feature branch', async () => {
    const exec = fakeGit({ '/r/proj': { top: '/r/proj', branch: 'feat/x' } });
    expect((await resolveCwd('/r/proj', { exec })).worktree.isPrimary).toBe(true);
  });

  it('probes an ssh location on the remote host and records it on the repository', async () => {
    const sshRun = vi.fn(async () => 'top=/srv/app\nbranch=main\ngitdir=/srv/app/.git\n');
    const out = await resolveCwd('/srv/app/packages/api', {
      location: { kind: 'ssh', ssh: { host: '10.0.0.2', user: 'build' }, label: 'builder' },
      sshRun,
    });
    expect(out.repository.root).toBe('/srv/app');
    expect(out.repository.isGit).toBe(true);
    expect(out.repository.location?.ssh?.host).toBe('10.0.0.2');
    expect(out.worktree.branch).toBe('main');
    // One round trip, and the remote command carries the cwd being probed.
    expect(sshRun).toHaveBeenCalledTimes(1);
    expect(sshRun.mock.calls[0]![0].join(' ')).toContain("cd '/srv/app/packages/api'");
  });

  it('falls back to a non-git repository when the remote host answers nothing', async () => {
    const out = await resolveCwd('/srv/missing', {
      location: { kind: 'ssh', ssh: { host: '10.0.0.2' } },
      sshRun: async () => '',
    });
    expect(out.repository.isGit).toBe(false);
    expect(out.repository.root).toBe('/srv/missing');
    expect(out.repository.location?.kind).toBe('ssh');
  });

  it('keeps a remote root apart from the identical local one', async () => {
    const exec = fakeGit({ '/srv/app': { top: '/srv/app', branch: 'main' } });
    const local = await resolveCwd('/srv/app', { exec });
    const remote = await resolveCwd('/srv/app', {
      location: { kind: 'ssh', ssh: { host: '10.0.0.2', user: 'build' } },
      sshRun: async () => 'top=/srv/app\nbranch=main\ngitdir=/srv/app/.git\n',
    });
    expect(remote.repository.repoId).not.toBe(local.repository.repoId);
    expect(local.repository.location).toBeUndefined();
  });

  it('scopes remote paths by locationKey', async () => {
    const exec = fakeGit({ '/srv/app': { top: '/srv/app', branch: 'main' } });
    const local = await resolveCwd('/srv/app', { exec });
    const remote = await resolveCwd('/srv/app', { exec, locationKey: 'ssh:build@10.0.0.2' });
    expect(remote.repository.repoId).not.toBe(local.repository.repoId);
  });
});

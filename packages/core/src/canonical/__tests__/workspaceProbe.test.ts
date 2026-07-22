import { describe, expect, test } from 'vitest';
import { probeWorkspace, normalizeRemoteUrl, canonicalizeRootPath } from '../workspaceProbe.js';
import type { CommandRunner } from '../doctor.js';

/** Fake git: maps `git <subcommand...>` to stdout, ignoring the `-C <dir>` pair. */
function git(map: Record<string, string>): CommandRunner {
  return async (command, args) => {
    if (command !== 'git') return { ok: false, stdout: '', code: 'ENOENT' };
    const rest = args[0] === '-C' ? args.slice(2) : args;
    const key = rest.join(' ');
    const hit = Object.entries(map).find(([k]) => key.startsWith(k));
    return hit ? { ok: true, stdout: hit[1] } : { ok: false, stdout: '', error: 'not a git repository' };
  };
}

const BASE = { cwd: '/repo/alpha', locationId: 'LOC', workspaceId: 'WS1' };

describe('canonicalizeRootPath', () => {
  test('drops trailing separators and collapses duplicates', () => {
    expect(canonicalizeRootPath('/repo/alpha/')).toBe('/repo/alpha');
    expect(canonicalizeRootPath('/repo//alpha')).toBe('/repo/alpha');
    expect(canonicalizeRootPath('  /repo/alpha  ')).toBe('/repo/alpha');
  });

  test('preserves the filesystem root', () => {
    expect(canonicalizeRootPath('/')).toBe('/');
  });
});

describe('normalizeRemoteUrl', () => {
  test('parses an https remote', () => {
    expect(normalizeRemoteUrl('https://github.com/acme/widgets.git')).toEqual({
      remoteUrlNormalized: 'https://github.com/acme/widgets',
      host: 'github.com',
      owner: 'acme',
      name: 'widgets',
    });
  });

  test('parses an scp-style ssh remote', () => {
    expect(normalizeRemoteUrl('git@github.com:acme/widgets.git')).toMatchObject({
      host: 'github.com',
      owner: 'acme',
      name: 'widgets',
    });
  });

  test('parses an ssh:// remote with a port', () => {
    expect(normalizeRemoteUrl('ssh://git@git.example.com:2222/acme/widgets.git')).toMatchObject({
      host: 'git.example.com',
      owner: 'acme',
      name: 'widgets',
    });
  });

  test('strips credentials before the url is ever stored', () => {
    const r = normalizeRemoteUrl('https://someuser:ghp_SECRETTOKEN123456@github.com/acme/widgets.git')!;
    expect(r.remoteUrlNormalized).not.toContain('ghp_SECRETTOKEN123456');
    expect(r.remoteUrlNormalized).not.toContain('someuser');
    expect(r.remoteUrlNormalized).toBe('https://github.com/acme/widgets');
  });

  test('handles a nested group path (self-hosted GitLab)', () => {
    expect(normalizeRemoteUrl('https://gitlab.example.com/group/sub/widgets.git')).toMatchObject({
      owner: 'group/sub',
      name: 'widgets',
    });
  });

  test('returns null for something that is not a remote url', () => {
    expect(normalizeRemoteUrl('')).toBeNull();
    expect(normalizeRemoteUrl('not a url')).toBeNull();
  });
});

describe('probeWorkspace — git repository', () => {
  test('uses the git toplevel as root and the remote for the repo name', async () => {
    const ws = await probeWorkspace(
      BASE,
      git({
        'rev-parse --show-toplevel': '/repo/alpha\n',
        'remote get-url origin': 'https://github.com/acme/widgets.git\n',
      }),
    );
    expect(ws.kind).toBe('git');
    expect(ws.rootPath).toBe('/repo/alpha');
    expect(ws.displayName).toBe('widgets');
    expect(ws.repo).toMatchObject({ host: 'github.com', owner: 'acme', name: 'widgets' });
  });

  test('a subdirectory resolves to the repository root, not the cwd', async () => {
    const ws = await probeWorkspace(
      { ...BASE, cwd: '/repo/alpha/packages/ui' },
      git({ 'rev-parse --show-toplevel': '/repo/alpha\n' }),
    );
    expect(ws.rootPath).toBe('/repo/alpha');
  });

  test('a git repo with no remote falls back to the directory name', async () => {
    const ws = await probeWorkspace(BASE, git({ 'rev-parse --show-toplevel': '/repo/alpha\n' }));
    expect(ws.kind).toBe('git');
    expect(ws.displayName).toBe('alpha');
    expect(ws.repo).toBeUndefined();
  });

  test('never stores remote credentials', async () => {
    const ws = await probeWorkspace(
      BASE,
      git({
        'rev-parse --show-toplevel': '/repo/alpha\n',
        'remote get-url origin': 'https://u:ghp_SECRET999888777@github.com/acme/widgets.git\n',
      }),
    );
    expect(JSON.stringify(ws)).not.toContain('ghp_SECRET999888777');
  });
});

describe('probeWorkspace — non-git folder', () => {
  test('falls back to the chosen cwd and its basename', async () => {
    const ws = await probeWorkspace(BASE, git({}));
    expect(ws.kind).toBe('folder');
    expect(ws.rootPath).toBe('/repo/alpha');
    expect(ws.displayName).toBe('alpha');
  });

  test('a missing git binary degrades to a folder workspace, not an error', async () => {
    const ws = await probeWorkspace(BASE, async () => ({ ok: false, stdout: '', code: 'ENOENT' }));
    expect(ws.kind).toBe('folder');
  });

  test('a runner that throws still yields a usable folder workspace', async () => {
    const ws = await probeWorkspace(BASE, async () => {
      throw new Error('spawn failed');
    });
    expect(ws.kind).toBe('folder');
    expect(ws.rootPath).toBe('/repo/alpha');
  });
});

describe('probeWorkspace — identity', () => {
  test('a user-set custom name always wins the display', async () => {
    const ws = await probeWorkspace(
      { ...BASE, customName: 'My Project' },
      git({
        'rev-parse --show-toplevel': '/repo/alpha\n',
        'remote get-url origin': 'https://github.com/acme/widgets.git\n',
      }),
    );
    expect(ws.displayName).toBe('My Project');
    expect(ws.customName).toBe('My Project');
    expect(ws.repo?.name).toBe('widgets');
  });

  test('carries the supplied ids and canonicalizes the root path', async () => {
    const ws = await probeWorkspace(
      { ...BASE, cwd: '/repo/alpha/' },
      git({}),
    );
    expect(ws.workspaceId).toBe('WS1');
    expect(ws.locationId).toBe('LOC');
    expect(ws.rootPath).toBe('/repo/alpha');
  });
});

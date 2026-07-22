import { describe, it, expect } from 'vitest';
import { sshListDirs } from '../sshBrowse.js';
import type { SshTarget } from '@claude-alive/core';

const T: SshTarget = { host: 'h', user: 'u' };

describe('sshListDirs', () => {
  it('parses pwd (first line) + dir entries (trailing slash stripped)', async () => {
    const run = async (args: string[]) => {
      expect(args[args.length - 1]).toContain('pwd');
      return { code: 0, stdout: '/Users/dev/projects\nl2u-2nd/\nblock/\nREADME.md\n', stderr: '' };
    };
    const r = await sshListDirs(T, undefined, { run });
    expect(r.path).toBe('/Users/dev/projects');
    expect(r.dirs).toEqual(['l2u-2nd', 'block']); // README.md (no trailing /) excluded
  });

  it('quotes an absolute path and defaults to ~ when none given', async () => {
    let cmd = '';
    const run = async (args: string[]) => {
      cmd = args[args.length - 1]!;
      return { code: 0, stdout: '/srv\napp/\n', stderr: '' };
    };
    await sshListDirs(T, '/srv', { run });
    expect(cmd).toContain("cd '/srv'");
    await sshListDirs(T, undefined, { run });
    expect(cmd).toContain('cd ~');
  });

  it('rejects a flag-smuggling target', async () => {
    await expect(sshListDirs({ host: '-oProxyCommand=x' }, undefined, { run: async () => ({ code: 0, stdout: '', stderr: '' }) })).rejects.toThrow();
  });
});

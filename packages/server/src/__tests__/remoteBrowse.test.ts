import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browseRemoteDirs, BrowseError, MAX_BROWSE_ENTRIES } from '../remoteBrowse.js';

let root: string;
let outside: string;
let roots: string[];

beforeAll(async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'browse-')));
  root = join(base, 'work');
  outside = join(base, 'secret');
  await mkdir(join(root, 'a', 'b', 'c'), { recursive: true });
  await mkdir(join(root, 'a', '.hidden'), { recursive: true });
  await mkdir(join(root, 'repo', '.git'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(root, 'a', 'file.txt'), 'x');
  await symlink(outside, join(root, 'escape'), 'dir');
  roots = [root];
});

afterAll(async () => {
  await rm(join(root, '..'), { recursive: true, force: true });
});

describe('browseRemoteDirs', () => {
  it('lists the roots themselves when no path is given', async () => {
    const result = await browseRemoteDirs(null, roots);
    expect(result.path).toBeNull();
    expect(result.parent).toBeNull();
    expect(result.entries.map((e) => e.path)).toEqual([root]);
  });

  it('walks arbitrarily deep inside a root', async () => {
    const result = await browseRemoteDirs(join(root, 'a', 'b'), roots);
    expect(result.entries.map((e) => e.name)).toEqual(['c']);
    expect(result.parent).toBe(join(root, 'a'));
  });

  it('lists directories only, hiding dotfiles', async () => {
    const result = await browseRemoteDirs(join(root, 'a'), roots);
    expect(result.entries.map((e) => e.name)).toEqual(['b']);
  });

  it('marks checkouts', async () => {
    const result = await browseRemoteDirs(root, roots);
    const repo = result.entries.find((e) => e.name === 'repo');
    expect(repo?.isGit).toBe(true);
    expect(result.entries.find((e) => e.name === 'a')?.isGit).toBe(false);
  });

  it('has no parent at the root boundary', async () => {
    const result = await browseRemoteDirs(root, roots);
    expect(result.parent).toBeNull();
  });

  it('refuses a path outside the roots', async () => {
    await expect(browseRemoteDirs(outside, roots)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a symlink that resolves outside the roots', async () => {
    await expect(browseRemoteDirs(join(root, 'escape'), roots)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a relative path', async () => {
    await expect(browseRemoteDirs('work/a', roots)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses traversal through ..', async () => {
    await expect(browseRemoteDirs(join(root, '..', 'secret'), roots)).rejects.toMatchObject({ status: 403 });
  });

  it('404s a directory that does not exist', async () => {
    await expect(browseRemoteDirs(join(root, 'nope'), roots)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to browse at all when no roots are configured', async () => {
    await expect(browseRemoteDirs(null, [])).rejects.toBeInstanceOf(BrowseError);
  });

  it('caps the entry count', async () => {
    expect(MAX_BROWSE_ENTRIES).toBeGreaterThan(0);
  });
});

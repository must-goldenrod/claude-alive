import { describe, it, expect } from 'vitest';
import {
  createTicketCommitter,
  buildCommitMessage,
  parseStatusPaths,
  changedSince,
  MAX_AUTO_COMMIT_FILES,
  type GitExec,
  type MtimeProbe,
} from '../ticketCommit.js';
import type { Ticket } from '@claude-alive/core';

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1',
  seq: 7,
  goal: 'add the export button',
  cwd: '/repo',
  state: 'verifying',
  createdAt: 0,
  ...over,
});

/** Scripted git: maps `argv[0] argv[1]` to a result, defaulting to success. */
function gitStub(script: Record<string, { code?: number; stdout?: string; stderr?: string }>): {
  git: GitExec;
  calls: string[][];
} {
  const calls: string[][] = [];
  const git: GitExec = async (args) => {
    calls.push([...args]);
    const key = args.slice(0, 2).join(' ');
    const r = script[key] ?? script[args[0]!] ?? {};
    return { code: r.code ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  return { git, calls };
}

const REPO_OK = {
  'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
  'rev-parse --show-toplevel': { stdout: '/repo\n' },
};

/** Porcelain v1 in -z mode: `XY path` records, NUL-terminated. */
const z = (...entries: string[]) => entries.map((e) => `${e}\0`).join('');

/** Everything was written after the ticket started. */
const freshMtime: MtimeProbe = async () => 5_000;

describe('buildCommitMessage', () => {
  it('is bilingual and names the ticket, the verdict and the reviewers', () => {
    const msg = buildCommitMessage(
      ticket({
        headline: '내보내기 버튼 추가',
        verification: {
          passed: true,
          reason: 'button renders and exports',
          consensus: { agree: 3, total: 3 },
          panel: [
            { model: 'a', passed: true, reason: 'ok' },
            { model: 'b', passed: null, reason: '', error: 'timeout' },
          ],
        },
      }),
    );
    expect(msg.split('\n')[0]).toBe('chore(ticket #7): 내보내기 버튼 추가');
    expect(msg).toContain('목표:');
    expect(msg).toContain('Goal:');
    // Only the reviewer that actually voted is counted.
    expect(msg).toContain('1 gate + 1 panel reviewer(s)');
    expect(msg).toContain('(3/3)');
    expect(msg).toContain('ticket-id: t1');
  });

  it('falls back to the goal when there is no headline, and caps the subject', () => {
    const msg = buildCommitMessage(ticket({ goal: 'x'.repeat(300) }));
    expect(msg.split('\n')[0].length).toBeLessThanOrEqual(100);
  });
});

describe('parseStatusPaths', () => {
  it('reads each record as a status pair plus a root-relative path', () => {
    expect(parseStatusPaths(z(' M src/a.ts', '?? src/new.ts', ' D old.ts'))).toEqual([
      { path: 'src/a.ts', deleted: false },
      { path: 'src/new.ts', deleted: false },
      { path: 'old.ts', deleted: true },
    ]);
  });

  it('reads a deletion staged on either side', () => {
    expect(parseStatusPaths(z('D  gone.ts'))[0]).toEqual({ path: 'gone.ts', deleted: true });
  });

  it('is empty for a clean tree', () => {
    expect(parseStatusPaths('')).toEqual([]);
  });
});

describe('changedSince', () => {
  const entries = [
    { path: 'mine.ts', deleted: false },
    { path: 'someone-elses.ts', deleted: false },
    { path: 'gone.ts', deleted: true },
  ];
  const mtime: MtimeProbe = async (path) => (path.endsWith('mine.ts') ? 5_000 : 100);

  it('keeps only what was written while the ticket ran', async () => {
    expect(await changedSince(entries, '/repo', 1_000, mtime)).toEqual(['mine.ts', 'gone.ts']);
  });

  it('keeps everything when the ticket has no start time', async () => {
    expect(await changedSince(entries, '/repo', undefined, mtime)).toHaveLength(3);
  });

  it('keeps a path it cannot stat rather than dropping a real change', async () => {
    expect(await changedSince([entries[0]!], '/repo', 1_000, async () => null)).toEqual(['mine.ts']);
  });
});

describe('createTicketCommitter', () => {
  const running = (over: Partial<Ticket> = {}) => ticket({ startedAt: 1_000, ...over });

  it('commits the paths written while the ticket ran and reports the sha', async () => {
    const { git, calls } = gitStub({
      ...REPO_OK,
      'status --porcelain=v1': { stdout: z(' M src/a.ts', '?? src/b.ts') },
      'diff --cached': { stdout: 'src/a.ts\nsrc/b.ts\n' },
      'rev-parse --short': { stdout: 'abc1234\n' },
    });
    const c = await createTicketCommitter({ git, now: () => 9, mtime: freshMtime }).commit(
      running({ headline: 'done' }),
    );
    expect(c).toMatchObject({ committed: true, sha: 'abc1234', files: 2, at: 9 });
    // The survey is scoped to the ticket's subtree; staging names exact paths.
    expect(calls).toContainEqual([
      'status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--', '.',
    ]);
    expect(calls).toContainEqual(['add', '--', 'src/a.ts', 'src/b.ts']);
    // Only these paths are committed, whatever else the index holds.
    expect(calls.find((a) => a[0] === 'commit')?.slice(-3)).toEqual(['--', 'src/a.ts', 'src/b.ts']);
  });

  it('leaves behind work that predates the run', async () => {
    const { git, calls } = gitStub({
      ...REPO_OK,
      'status --porcelain=v1': { stdout: z(' M mine.ts', ' M stale.ts') },
      'diff --cached': { stdout: 'mine.ts\n' },
      'rev-parse --short': { stdout: 'abc1234\n' },
    });
    const mtime: MtimeProbe = async (p) => (p.endsWith('mine.ts') ? 5_000 : 100);
    const c = await createTicketCommitter({ git, mtime }).commit(running());
    expect(c).toMatchObject({ committed: true, files: 1 });
    expect(calls).toContainEqual(['add', '--', 'mine.ts']);
  });

  it('does nothing when every change predates the run', async () => {
    const { git, calls } = gitStub({
      ...REPO_OK,
      'status --porcelain=v1': { stdout: z(' M stale.ts') },
    });
    const c = await createTicketCommitter({ git, mtime: async () => 100 }).commit(running());
    expect(c.committed).toBe(false);
    expect(c.skipped).toBe('티켓이 도는 동안 변경된 파일이 없습니다');
    expect(calls.some((a) => a[0] === 'commit')).toBe(false);
  });

  // Regression: a read-only ticket auto-committed 365 files it had not written.
  it('refuses a sweep larger than the cap', async () => {
    const many = Array.from({ length: MAX_AUTO_COMMIT_FILES + 1 }, (_, i) => ` M f${i}.ts`);
    const { git, calls } = gitStub({ ...REPO_OK, 'status --porcelain=v1': { stdout: z(...many) } });
    const c = await createTicketCommitter({ git, mtime: freshMtime }).commit(running());
    expect(c.committed).toBe(false);
    expect(c.skipped).toContain(`파일 ${MAX_AUTO_COMMIT_FILES + 1}개 변경`);
    expect(c.skipped).toContain('커밋하지 않았습니다');
    expect(calls.some((a) => a[0] === 'add' || a[0] === 'commit')).toBe(false);
  });

  it('commits right up to the cap', async () => {
    const many = Array.from({ length: MAX_AUTO_COMMIT_FILES }, (_, i) => ` M f${i}.ts`);
    const { git } = gitStub({
      ...REPO_OK,
      'status --porcelain=v1': { stdout: z(...many) },
      'diff --cached': { stdout: many.map((_, i) => `f${i}.ts`).join('\n') },
      'rev-parse --short': { stdout: 'abc1234\n' },
    });
    const c = await createTicketCommitter({ git, mtime: freshMtime }).commit(running());
    expect(c).toMatchObject({ committed: true, files: MAX_AUTO_COMMIT_FILES });
  });

  it('does nothing when the tree is clean', async () => {
    const { git, calls } = gitStub({ ...REPO_OK, 'status --porcelain=v1': { stdout: '' } });
    const c = await createTicketCommitter({ git }).commit(running());
    expect(c.committed).toBe(false);
    expect(c.skipped).toContain('작업 트리 깨끗');
    expect(calls.some((a) => a[0] === 'commit')).toBe(false);
  });

  it('skips a directory that is not a git repository', async () => {
    const { git } = gitStub({ 'rev-parse --is-inside-work-tree': { code: 128, stderr: 'not a git repo' } });
    const c = await createTicketCommitter({ git }).commit(running());
    expect(c).toMatchObject({ committed: false, skipped: 'git 저장소가 아닙니다' });
  });

  it('skips a remote ticket — the changes are on the other host', async () => {
    const { git, calls } = gitStub(REPO_OK);
    const c = await createTicketCommitter({ git }).commit(
      running({ location: { kind: 'ssh', ssh: { host: 'box' } } }),
    );
    expect(c.committed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reports a failing commit instead of throwing', async () => {
    const { git } = gitStub({
      ...REPO_OK,
      'status --porcelain=v1': { stdout: z(' M a.ts') },
      'diff --cached': { stdout: 'a.ts\n' },
      commit: { code: 1, stderr: 'Author identity unknown' },
    });
    const c = await createTicketCommitter({ git, mtime: freshMtime }).commit(running());
    expect(c.committed).toBe(false);
    expect(c.skipped).toContain('Author identity unknown');
  });

  it('never pushes', async () => {
    const { git, calls } = gitStub({
      ...REPO_OK,
      'status --porcelain=v1': { stdout: z(' M a.ts') },
      'diff --cached': { stdout: 'a.ts\n' },
      'rev-parse --short': { stdout: 'deadbee\n' },
    });
    await createTicketCommitter({ git, mtime: freshMtime }).commit(running());
    expect(calls.some((a) => a[0] === 'push')).toBe(false);
  });
});

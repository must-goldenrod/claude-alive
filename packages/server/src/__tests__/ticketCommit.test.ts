import { describe, it, expect } from 'vitest';
import { createTicketCommitter, buildCommitMessage, type GitExec } from '../ticketCommit.js';
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

const REPO_OK = { 'rev-parse --is-inside-work-tree': { stdout: 'true\n' } };

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

describe('createTicketCommitter', () => {
  it('commits the staged subtree and reports the sha', async () => {
    const { git, calls } = gitStub({
      ...REPO_OK,
      'diff --cached': { stdout: 'src/a.ts\nsrc/b.ts\n' },
      'rev-parse --short': { stdout: 'abc1234\n' },
    });
    const c = await createTicketCommitter({ git, now: () => 9 }).commit(ticket({ headline: 'done' }));
    expect(c).toMatchObject({ committed: true, sha: 'abc1234', files: 2, at: 9 });
    // Staging is scoped to the ticket's own subtree, not the whole repository.
    expect(calls).toContainEqual(['add', '-A', '--', '.']);
  });

  it('does nothing when the tree is clean', async () => {
    const { git, calls } = gitStub({ ...REPO_OK, 'diff --cached': { stdout: '' } });
    const c = await createTicketCommitter({ git }).commit(ticket());
    expect(c.committed).toBe(false);
    expect(c.skipped).toContain('clean');
    expect(calls.some((a) => a[0] === 'commit')).toBe(false);
  });

  it('skips a directory that is not a git repository', async () => {
    const { git } = gitStub({ 'rev-parse --is-inside-work-tree': { code: 128, stderr: 'not a git repo' } });
    const c = await createTicketCommitter({ git }).commit(ticket());
    expect(c).toMatchObject({ committed: false, skipped: 'not a git repository' });
  });

  it('skips a remote ticket — the changes are on the other host', async () => {
    const { git, calls } = gitStub(REPO_OK);
    const c = await createTicketCommitter({ git }).commit(
      ticket({ location: { kind: 'ssh', ssh: { host: 'box' } } }),
    );
    expect(c.committed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reports a failing commit instead of throwing', async () => {
    const { git } = gitStub({
      ...REPO_OK,
      'diff --cached': { stdout: 'a.ts\n' },
      commit: { code: 1, stderr: 'Author identity unknown' },
    });
    const c = await createTicketCommitter({ git }).commit(ticket());
    expect(c.committed).toBe(false);
    expect(c.skipped).toContain('Author identity unknown');
  });

  it('never pushes', async () => {
    const { git, calls } = gitStub({
      ...REPO_OK,
      'diff --cached': { stdout: 'a.ts\n' },
      'rev-parse --short': { stdout: 'deadbee\n' },
    });
    await createTicketCommitter({ git }).commit(ticket());
    expect(calls.some((a) => a[0] === 'push')).toBe(false);
  });
});

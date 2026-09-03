/**
 * Post-verification auto-commit.
 *
 * A ticket that passed the gate has produced work nobody watched being made. If
 * it is left uncommitted it sits in the working tree until the next ticket runs
 * in the same directory and silently absorbs it — at which point neither change
 * can be reviewed on its own any more. Committing at the moment the gate turns
 * green is what keeps one ticket equal to one reviewable unit.
 *
 * It is deliberately tied to the verdict rather than to the agent: the agent is
 * the party whose claim is under review, so "did you commit?" cannot be left to
 * it. Three things are never done here — pushing, branching, and committing a
 * ticket that failed — because all three are hard to walk back from.
 */
import { execFile } from 'node:child_process';
import type { Ticket, TicketCommit } from '@claude-alive/core';

export interface GitExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable git runner (tests stub it; production shells out). */
export type GitExec = (args: readonly string[], cwd: string) => Promise<GitExecResult>;

export const defaultGitExec: GitExec = (args, cwd) =>
  new Promise((resolveExec) => {
    execFile('git', [...args], { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
      resolveExec({ code, stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });

/** Subject line cap; git convention keeps subjects short and greppable. */
const MAX_SUBJECT = 100;

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Bilingual commit message (repo convention: `<type>: <한글> / <English>`).
 *
 * The subject carries the ticket's own headline, which is written in whatever
 * language the goal was. The body's fixed bilingual lines state what is provable
 * without a translator — which ticket, which verdict, how it was reviewed — so
 * the message never pretends to a translation it does not have.
 */
export function buildCommitMessage(ticket: Ticket): string {
  const summary = oneLine(ticket.headline || ticket.goal);
  const subject = `chore(ticket #${ticket.seq}): ${summary}`.slice(0, MAX_SUBJECT);
  const v = ticket.verification;
  const panelCount = v?.panel?.filter((o) => o.passed !== null).length ?? 0;
  const consensus = v?.consensus ? ` (${v.consensus.agree}/${v.consensus.total})` : '';
  return [
    subject,
    '',
    `목표: ${oneLine(ticket.goal)}`,
    `Goal: ${oneLine(ticket.goal)}`,
    '',
    `검증: 통과${consensus} — 게이트 1 + 리뷰 패널 ${panelCount}`,
    `Verification: passed${consensus} — 1 gate + ${panelCount} panel reviewer(s)`,
    v?.reason ? `근거 / Reason: ${oneLine(v.reason)}` : '',
    '',
    `ticket-id: ${ticket.id}`,
  ]
    .filter((l) => l !== '')
    .join('\n')
    .replace(/\n(ticket-id:)/, '\n\n$1');
}

export interface TicketCommitter {
  commit(ticket: Ticket): Promise<TicketCommit>;
}

export function createTicketCommitter(deps: { git?: GitExec; now?: () => number } = {}): TicketCommitter {
  const git = deps.git ?? defaultGitExec;
  const now = deps.now ?? Date.now;

  return {
    async commit(ticket) {
      const at = now();
      const skip = (skipped: string): TicketCommit => ({ committed: false, skipped, at });

      // Remote tickets run their agent over SSH; the changes are on that host,
      // not here, so committing locally would capture nothing.
      if (ticket.location?.kind === 'ssh') return skip('remote ticket — commit on the remote host');

      const isRepo = await git(['rev-parse', '--is-inside-work-tree'], ticket.cwd);
      if (isRepo.code !== 0 || isRepo.stdout.trim() !== 'true') return skip('not a git repository');

      // Stage only this ticket's subtree. `git add -A` alone is repository-wide
      // and would sweep in unrelated edits from elsewhere in the repo.
      const staged = await git(['add', '-A', '--', '.'], ticket.cwd);
      if (staged.code !== 0) return { committed: false, skipped: `git add failed: ${oneLine(staged.stderr)}`, at };

      const names = await git(['diff', '--cached', '--name-only'], ticket.cwd);
      const files = names.stdout.split('\n').filter(Boolean).length;
      if (files === 0) return skip('nothing to commit — working tree clean');

      const message = buildCommitMessage(ticket);
      const done = await git(['commit', '-m', message], ticket.cwd);
      if (done.code !== 0) {
        return { committed: false, message, files, skipped: `git commit failed: ${oneLine(done.stderr || done.stdout)}`, at };
      }

      const sha = await git(['rev-parse', '--short', 'HEAD'], ticket.cwd);
      return {
        committed: true,
        ...(sha.code === 0 && sha.stdout.trim() ? { sha: sha.stdout.trim() } : {}),
        message: message.split('\n')[0],
        files,
        at,
      };
    },
  };
}

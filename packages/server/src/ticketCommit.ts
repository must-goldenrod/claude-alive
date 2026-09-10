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
 *
 * What it commits is bounded twice, because the wide version of this is worse
 * than not running at all: only paths under the ticket's own cwd, and among
 * those, only ones written after the run started. A checkpoint hook already
 * commits most tickets' work, so by the time this runs the tree is usually clean
 * and anything still dirty is more likely to be somebody else's.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Ticket, TicketCommit } from '@claude-alive/core';

export interface GitExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable git runner (tests stub it; production shells out). */
export type GitExec = (args: readonly string[], cwd: string) => Promise<GitExecResult>;

/** Injectable mtime probe. Returns null when the path is gone. */
export type MtimeProbe = (path: string) => Promise<number | null>;

export const defaultMtime: MtimeProbe = async (path) => {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
};

/**
 * Ceiling on an auto-commit.
 *
 * A read-only ticket once committed 365 files: it swept a directory that had
 * been left dirty by other work. Past this many changed files the sweep is more
 * likely than the ticket, so nothing is committed and the tree is left for a
 * human — the outcome the feature exists to avoid, but far cheaper to undo than
 * a 365-file commit sitting in history.
 */
export const MAX_AUTO_COMMIT_FILES = 50;

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

/** One changed path from `git status --porcelain=v1 -z --no-renames`. */
export interface StatusEntry {
  /** Repository-root-relative, which is what porcelain always reports. */
  path: string;
  deleted: boolean;
}

/**
 * Parse porcelain v1 in `-z` mode. `--no-renames` is what makes this safe to
 * split naively: with renames on, one record carries two NUL-separated paths and
 * the second would be misread as a status code.
 */
export function parseStatusPaths(z: string): StatusEntry[] {
  return z
    .split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry) => ({ path: entry.slice(3), deleted: entry[0] === 'D' || entry[1] === 'D' }));
}

/**
 * The changes this ticket is actually responsible for.
 *
 * A file whose content is older than the run was left behind by something else —
 * a previous ticket that never committed, an editor session, another agent — and
 * committing it puts someone else's work under this ticket's verdict. Deletions
 * carry no mtime, so they are kept: a half-committed rename is worse than a
 * slightly wide commit, and `--no-renames` makes deletions the rare half.
 */
export async function changedSince(
  entries: readonly StatusEntry[],
  root: string,
  since: number | undefined,
  mtime: MtimeProbe,
): Promise<string[]> {
  if (since === undefined) return entries.map((e) => e.path);
  const kept: string[] = [];
  for (const entry of entries) {
    if (entry.deleted) {
      kept.push(entry.path);
      continue;
    }
    const at = await mtime(join(root, entry.path));
    if (at === null || at >= since) kept.push(entry.path);
  }
  return kept;
}

export interface TicketCommitterDeps {
  git?: GitExec;
  now?: () => number;
  mtime?: MtimeProbe;
}

export function createTicketCommitter(deps: TicketCommitterDeps = {}): TicketCommitter {
  const git = deps.git ?? defaultGitExec;
  const now = deps.now ?? Date.now;
  const mtime = deps.mtime ?? defaultMtime;

  return {
    async commit(ticket) {
      const at = now();
      const skip = (skipped: string): TicketCommit => ({ committed: false, skipped, at });

      // Remote tickets run their agent over SSH; the changes are on that host,
      // not here, so committing locally would capture nothing.
      if (ticket.location?.kind === 'ssh') return skip('원격 티켓 — 커밋은 원격 호스트에서 이루어집니다');

      const isRepo = await git(['rev-parse', '--is-inside-work-tree'], ticket.cwd);
      if (isRepo.code !== 0 || isRepo.stdout.trim() !== 'true') return skip('git 저장소가 아닙니다');

      // Porcelain paths are root-relative, so staging has to run from the root
      // even though the survey is scoped to the ticket's own subtree by `-- .`.
      const top = await git(['rev-parse', '--show-toplevel'], ticket.cwd);
      const root = top.code === 0 && top.stdout.trim() ? top.stdout.trim() : ticket.cwd;

      const status = await git(
        ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--', '.'],
        ticket.cwd,
      );
      if (status.code !== 0) return skip(`git status 실패: ${oneLine(status.stderr)}`);

      const entries = parseStatusPaths(status.stdout);
      if (entries.length === 0) return skip('커밋할 변경이 없습니다 — 작업 트리 깨끗');

      const paths = await changedSince(entries, root, ticket.startedAt, mtime);
      if (paths.length === 0) return skip('티켓이 도는 동안 변경된 파일이 없습니다');
      if (paths.length > MAX_AUTO_COMMIT_FILES) {
        return skip(
          `파일 ${paths.length}개 변경 (상한 ${MAX_AUTO_COMMIT_FILES}) — 검토를 위해 커밋하지 않았습니다`,
        );
      }

      const staged = await git(['add', '--', ...paths], root);
      if (staged.code !== 0) return { committed: false, skipped: `git add 실패: ${oneLine(staged.stderr)}`, at };

      const names = await git(['diff', '--cached', '--name-only', '--', ...paths], root);
      const files = names.stdout.split('\n').filter(Boolean).length;
      if (files === 0) return skip('커밋할 변경이 없습니다 — 작업 트리 깨끗');

      const message = buildCommitMessage(ticket);
      // Commit exactly these paths: anything staged elsewhere in the repo before
      // the ticket ran is not this ticket's to claim.
      const done = await git(['commit', '-m', message, '--', ...paths], root);
      if (done.code !== 0) {
        return { committed: false, message, files, skipped: `git commit 실패: ${oneLine(done.stderr || done.stdout)}`, at };
      }

      const sha = await git(['rev-parse', '--short', 'HEAD'], root);
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

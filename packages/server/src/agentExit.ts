/**
 * Turn a dead agent process into an explanation.
 *
 * The runner used to record `main agent exited (code 143)` and nothing else.
 * That line answers none of the questions a human actually has: did it crash or
 * was it stopped? did it run for eight minutes or die at startup? is the work
 * recoverable? It also mislabels two very different endings — a process killed
 * by SIGKILL reports `code: null`, exactly like a process that never started,
 * and both used to print "failed to spawn claude".
 *
 * So the exit is recorded as structured facts (`TicketAgentExit`) plus a
 * one-line summary. The UI renders the facts in the reader's language; the
 * summary is what a card, a log line, or an API consumer sees.
 *
 * Signal inference: a process killed by a signal it does not handle is reported
 * by Node as `{code: null, signal: 'SIGKILL'}`. A process that *handles* the
 * signal — `claude` does this for SIGTERM — exits normally with 128+n, and the
 * signal is then lost. Measured on this machine: SIGTERM → `{code: 143,
 * signal: null}`, SIGKILL → `{code: null, signal: 'SIGKILL'}`. So 128+n is read
 * back into a signal name, flagged as inferred so the record never claims more
 * certainty than it has.
 */
import type { TicketAgentExit, TicketAgentExitCause } from '@claude-alive/core';

/** Signals worth naming when an exit code carries them as 128+n. */
const SIGNAL_BY_NUMBER: Readonly<Record<number, string>> = {
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  6: 'SIGABRT',
  9: 'SIGKILL',
  11: 'SIGSEGV',
  13: 'SIGPIPE',
  15: 'SIGTERM',
};

const CAUSE_BY_SIGNAL: Readonly<Record<string, TicketAgentExitCause>> = {
  SIGTERM: 'terminated',
  SIGINT: 'interrupted',
  SIGHUP: 'hangup',
  SIGKILL: 'killed',
};

/** How much stderr is worth keeping on the ticket record. */
const STDERR_LIMIT = 600;
/** A summary has to fit one card line. */
const SUMMARY_LIMIT = 200;

export interface AgentExitFacts {
  /** Process exit status. `null` = the process produced none (signal, or never ran). */
  exitCode: number | null;
  /** Signal name as reported by the OS, when it reported one. */
  signal?: string | null;
  stderr?: string;
  /** The final stream-json result, when one arrived. */
  result?: { result: string | null; isError: boolean; subtype?: string | null } | null;
  /** Wallclock the run lasted, ms. */
  ranMs?: number;
  /** Which agent run this was (1 = the first). */
  round?: number;
  /** True when a Claude session id was captured, so the thread can be resumed. */
  resumable?: boolean;
}

/** `465872` → `7m 45s`. Undefined duration stays undefined rather than becoming "0s". */
export function formatRanFor(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Collapse stderr to a single storable line, newest content kept. */
function stderrTail(raw: string | undefined): string | undefined {
  const collapsed = raw?.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  return collapsed.length > STDERR_LIMIT ? `…${collapsed.slice(-STDERR_LIMIT + 1)}` : collapsed;
}

function classify(exitCode: number | null, reported: string | null | undefined): {
  cause: TicketAgentExitCause;
  signal?: string;
  signalInferred?: boolean;
} {
  if (reported) {
    return { cause: CAUSE_BY_SIGNAL[reported] ?? 'exited', signal: reported };
  }
  if (exitCode === null) return { cause: 'spawn-failed' };
  if (exitCode > 128) {
    const named = SIGNAL_BY_NUMBER[exitCode - 128];
    if (named) return { cause: CAUSE_BY_SIGNAL[named] ?? 'exited', signal: named, signalInferred: true };
  }
  return { cause: 'exited' };
}

/** ` (7m 45s 실행)`, or nothing when the duration is unknown. */
function ranClause(ranMs: number | undefined): string {
  const ran = formatRanFor(ranMs);
  return ran ? ` (${ran} 실행)` : '';
}

/**
 * The stored one-liner, in Korean.
 *
 * This string is what the ticket card and the API show, so it is written in the
 * reader's language like every other judgement the UI surfaces. Only the
 * identifiers stay verbatim: signal names, exit codes and the process's own
 * stderr are things a reader copies into a terminal, not prose.
 */
function summarize(exit: TicketAgentExit): string {
  const ran = ranClause(exit.ranMs);
  const code = exit.code !== undefined ? ` (exit ${exit.code})` : '';
  const detail = exit.stderr ? `: ${exit.stderr}` : '';
  switch (exit.cause) {
    case 'terminated':
      return `에이전트가 SIGTERM 으로 종료됨${code}${ran} — 바깥에서 내린 종료 요청이며 비정상 종료가 아님`;
    case 'interrupted':
      return `에이전트가 SIGINT 로 중단됨${code}${ran} — 인터럽트가 프로세스에 전달됨`;
    case 'hangup':
      return `에이전트가 SIGHUP 으로 끊김${code}${ran} — 부모 프로세스나 터미널이 사라짐`;
    case 'killed':
      return `에이전트가 SIGKILL 로 강제 종료됨${code}${ran} — 정리할 기회 없음, 대개 메모리 압박`;
    case 'spawn-failed':
      return exit.stderr ? `에이전트가 시작조차 못 함${detail}` : '에이전트가 시작조차 못 했고 오류 출력도 없음';
    case 'no-result':
      return exit.resultSubtype
        ? `에이전트는 정상 종료했지만${ran} 최종 결과가 오류였음 (${exit.resultSubtype})`
        : `에이전트는 정상 종료했지만${ran} 최종 결과를 내지 않음`;
    case 'exited':
      return exit.stderr
        ? `에이전트가 code ${exit.code} 로 종료됨${ran}${detail}`
        : `에이전트가 code ${exit.code} 로 종료됨${ran} — 오류 출력 없음`;
  }
}

/**
 * Classify one agent process's death and phrase it.
 *
 * `no-result` is decided last and only for a clean exit: a process that died on
 * a signal has an explanation better than "it produced no result", and saying
 * both would bury the one that matters.
 */
export function describeAgentExit(facts: AgentExitFacts): { exit: TicketAgentExit; summary: string } {
  const { cause, signal, signalInferred } = classify(facts.exitCode, facts.signal);
  const stderr = stderrTail(facts.stderr);
  const missingResult = facts.result == null || facts.result.isError;
  const finalCause: TicketAgentExitCause = cause === 'exited' && facts.exitCode === 0 && missingResult ? 'no-result' : cause;

  const exit: TicketAgentExit = {
    cause: finalCause,
    ...(facts.exitCode !== null ? { code: facts.exitCode } : {}),
    ...(signal ? { signal } : {}),
    ...(signalInferred ? { signalInferred: true } : {}),
    ...(facts.ranMs !== undefined ? { ranMs: facts.ranMs } : {}),
    ...(facts.round !== undefined ? { round: facts.round } : {}),
    resumable: Boolean(facts.resumable),
    ...(facts.result?.subtype ? { resultSubtype: facts.result.subtype } : {}),
    ...(stderr ? { stderr } : {}),
  };

  const summary = summarize(exit);
  return { exit, summary: summary.length > SUMMARY_LIMIT ? `${summary.slice(0, SUMMARY_LIMIT - 1)}…` : summary };
}

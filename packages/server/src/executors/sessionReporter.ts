/**
 * Early session-id reporting.
 *
 * `HeadlessOutcome.sessionId` is only available once the process exits, which is
 * too late for the runs that matter: a cancelled or killed agent resolves its
 * outcome after the ticket has already reached a terminal state, so the id is
 * dropped and the (already paid for) conversation becomes unreachable.
 *
 * The stream announces the id in its `init` event, within the first moments of a
 * run. This adapter lifts that out of the event stream so the caller can persist
 * it immediately. The `result` event is honoured too, since a resumed run reports
 * its id there.
 */
import type { StreamEvent } from '../streamJson.js';

/** Build an `onEvent` handler that forwards each newly seen session id exactly once. */
export function sessionIdReporter(report: (sessionId: string) => void): (e: StreamEvent) => void {
  let last: string | null = null;
  return (e: StreamEvent) => {
    const id = e.kind === 'init' ? e.sessionId : e.kind === 'result' ? e.result.sessionId : null;
    if (!id || id === last) return;
    last = id;
    report(id);
  };
}

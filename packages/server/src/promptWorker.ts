/**
 * Thin wrapper around the absorbed @think-prompt/worker library. The
 * worker now runs in-process inside the claude-alive server (no fork,
 * no pidfile). This module exists only so index.ts has one symbol to
 * call and one shutdown handle to invoke.
 */
import { startWorkerLoop as start } from '@think-prompt/worker';

export function startWorkerLoop(): () => void {
  const handle = start();
  return () => {
    // Fire-and-forget — the SIGINT path doesn't await the worker drain.
    // Jobs are file-queued (queue.jsonl) so any in-flight work resumes
    // on the next server start without loss.
    void handle.stop();
  };
}

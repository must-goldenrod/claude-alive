/**
 * Thin wrapper around the absorbed @think-prompt/worker library. The
 * worker now runs in-process inside the claude-alive server (no fork,
 * no pidfile). This module exists only so index.ts has one symbol to
 * call and one shutdown handle to invoke.
 */
import { startWorkerLoop as start } from '@think-prompt/worker';

export function startWorkerLoop(): () => void {
  // Startup opens a native-SQLite-backed queue. Errors *inside* the loop were
  // already contained, but this synchronous open was not: a stale native binding
  // (e.g. after a Node upgrade) threw here and killed the whole server. Prompt
  // analytics are optional, so a failure degrades to "worker not running" and is
  // logged loudly rather than taking the dashboard down (§C.7).
  let handle: { stop: () => unknown } | null = null;
  try {
    handle = start();
  } catch (error) {
    console.error(
      '[prompt-worker] failed to start — prompt analysis queue is not running. ' +
        'If this is a native module error, run `pnpm rebuild better-sqlite3`.',
      error,
    );
    return () => {};
  }
  return () => {
    // Fire-and-forget — the SIGINT path doesn't await the worker drain.
    // Jobs are file-queued (queue.jsonl) so any in-flight work resumes
    // on the next server start without loss.
    void handle.stop();
  };
}

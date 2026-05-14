/**
 * @think-prompt/worker — library export of the queue-consumer loop.
 *
 * As of D-048+ absorption into claude-alive, this is no longer a
 * standalone Node process. claude-alive's server imports
 * `startWorkerLoop()` and runs it in-process. The exported function
 * returns a stop handle so the server can shut the loop down cleanly on
 * SIGINT. No pidfile, no process.exit().
 */
import {
  commitOffset,
  createLogger,
  getPaths,
  loadConfig,
  openDb,
  readPendingJobs,
  requeue,
} from '@think-prompt/core';
import { HANDLERS } from './jobs.js';

const MAX_ATTEMPTS = 5;
const IDLE_POLL_MS = 500;

export interface WorkerLoopOptions {
  rootOverride?: string;
}

export interface WorkerLoopHandle {
  stop: () => Promise<void>;
}

export function startWorkerLoop(opts: WorkerLoopOptions = {}): WorkerLoopHandle {
  const paths = getPaths(opts.rootOverride);
  const config = loadConfig(opts.rootOverride);
  const logger = createLogger('worker', { file: paths.workerLog, stdout: false });
  const db = openDb(opts.rootOverride);

  let stopped = false;
  let loopDone: Promise<void>;

  async function loop(): Promise<void> {
    logger.info({ pid: process.pid }, 'worker loop started (in-process)');
    while (!stopped) {
      const { jobs, newOffset } = readPendingJobs({
        queueFile: paths.queueFile,
        offsetFile: paths.queueOffsetFile,
        maxItems: 20,
      });
      if (jobs.length === 0) {
        await sleep(IDLE_POLL_MS);
        continue;
      }
      for (const job of jobs) {
        if (stopped) break;
        const handler = HANDLERS[job.kind];
        if (!handler) {
          logger.warn({ kind: job.kind }, 'unknown job kind');
          continue;
        }
        try {
          const res = await handler({ db, logger, config }, job.payload);
          if (res === 'retry') {
            if (job.attempts + 1 < MAX_ATTEMPTS) {
              requeue(paths.queueFile, job);
            } else {
              logger.error({ id: job.id }, 'DLQ: max attempts exceeded');
            }
          }
        } catch (err) {
          logger.error({ err, job }, 'job crashed');
          if (job.attempts + 1 < MAX_ATTEMPTS) requeue(paths.queueFile, job);
        }
      }
      commitOffset(paths.queueOffsetFile, newOffset);
    }
    try {
      db.close();
    } catch {
      // ignore
    }
    logger.info({}, 'worker loop stopped');
  }

  loopDone = loop().catch((err) => {
    logger.error({ err }, 'worker loop crashed');
  });

  return {
    async stop() {
      stopped = true;
      await loopDone;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

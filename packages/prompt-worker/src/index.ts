import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const paths = getPaths();
  const config = loadConfig();
  const logger = createLogger('worker', { file: paths.workerLog, stdout: true });
  const db = openDb();
  writeFileSync(paths.workerPid, String(process.pid), 'utf8');
  logger.info({ pid: process.pid }, 'worker running');

  let stopped = false;
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopped = true;
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

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
            logger.info({ id: job.id, attempts: job.attempts + 1 }, 'requeued');
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
  } finally {
    if (existsSync(paths.workerPid)) {
      try {
        unlinkSync(paths.workerPid);
      } catch {
        // ignore
      }
    }
  }
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('worker failed:', err);
  process.exit(1);
});

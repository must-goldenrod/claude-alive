/**
 * File-based JSONL queue. Append-only. Offset tracked in queue.offset.
 * Not thread-safe across processes, but we only have one writer (agent) + one reader (worker).
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { ulid } from './ulid.js';

export type QueueJobKind =
  | 'parse_transcript'
  | 'parse_subagent_transcript'
  | 'score_followup'
  | 'judge'
  | 'session_end';

export interface QueueJob<T = unknown> {
  id: string;
  ts: string;
  kind: QueueJobKind;
  payload: T;
  attempts: number;
}

export function enqueue<T>(queueFile: string, kind: QueueJobKind, payload: T): QueueJob<T> {
  mkdirSync(dirname(queueFile), { recursive: true });
  const job: QueueJob<T> = {
    id: ulid(),
    ts: new Date().toISOString(),
    kind,
    payload,
    attempts: 0,
  };
  appendFileSync(queueFile, `${JSON.stringify(job)}\n`, 'utf8');
  return job;
}

export interface ReadOptions {
  queueFile: string;
  offsetFile: string;
  maxItems?: number;
}

export function readPendingJobs(opts: ReadOptions): { jobs: QueueJob[]; newOffset: number } {
  if (!existsSync(opts.queueFile)) return { jobs: [], newOffset: 0 };
  const offset = existsSync(opts.offsetFile)
    ? Number.parseInt(readFileSync(opts.offsetFile, 'utf8').trim(), 10) || 0
    : 0;
  const size = statSync(opts.queueFile).size;
  if (offset >= size) return { jobs: [], newOffset: offset };
  const raw = readFileSync(opts.queueFile, 'utf8').slice(offset);
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const max = opts.maxItems ?? 100;
  const taken = lines.slice(0, max);
  const jobs: QueueJob[] = [];
  let consumed = 0;
  for (const line of taken) {
    try {
      jobs.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
    consumed += line.length + 1; // +1 for newline
  }
  return { jobs, newOffset: offset + consumed };
}

export function commitOffset(offsetFile: string, offset: number): void {
  mkdirSync(dirname(offsetFile), { recursive: true });
  writeFileSync(offsetFile, String(offset), 'utf8');
}

export function requeue<T>(queueFile: string, job: QueueJob<T>): void {
  const next: QueueJob<T> = { ...job, attempts: job.attempts + 1, ts: new Date().toISOString() };
  appendFileSync(queueFile, `${JSON.stringify(next)}\n`, 'utf8');
}

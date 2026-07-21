import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { CompletedSession, TokenUsage } from '@claude-alive/core';

/**
 * Persistent archive of completed (terminated) sessions.
 *
 * The in-memory SessionStore keeps only the most recent handful of completed
 * sessions for the live snapshot; this store is the durable, time-ordered
 * archive that survives a server restart and backs the Archive view's
 * "review terminated tickets by time" experience.
 *
 * Stored oldest→newest as a JSON array in ~/.claude-alive/completed-sessions.json.
 * Capped at MAX_ENTRIES so the file can't grow without bound on a long-lived host.
 */

const ARCHIVE_FILE = join(homedir(), '.claude-alive', 'completed-sessions.json');
const MAX_ENTRIES = 2000;

let cached: CompletedSession[] = [];
let flushPromise: Promise<void> | null = null;

/** Load the archive from disk. Call once on boot before serving requests. */
export async function loadCompletedSessions(): Promise<CompletedSession[]> {
  try {
    const raw = await readFile(ARCHIVE_FILE, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      cached = parsed.filter(
        (e): e is CompletedSession =>
          !!e && typeof e === 'object' && typeof (e as CompletedSession).sessionId === 'string',
      );
    } else {
      cached = [];
    }
  } catch {
    cached = [];
  }
  return cached;
}

/** Full archive, newest first. */
export function getCompletedArchive(): CompletedSession[] {
  return [...cached].reverse();
}

/** Append one completed session and flush to disk (best-effort). */
export async function appendCompletedSession(session: CompletedSession): Promise<void> {
  // Guard against a double-append for the same terminated session (SessionEnd
  // can, in rare races, be delivered more than once).
  const last = cached[cached.length - 1];
  if (last && last.sessionId === session.sessionId && last.completedAt === session.completedAt) {
    return;
  }
  cached.push(session);
  await serializedFlush();
}

/**
 * Backfill token usage onto the most recent archived record for a session.
 * Called when async transcript parsing resolves after the session was archived.
 */
export async function updateArchivedTokenUsage(
  sessionId: string,
  usage: TokenUsage,
): Promise<void> {
  for (let i = cached.length - 1; i >= 0; i--) {
    if (cached[i]!.sessionId === sessionId) {
      cached[i] = { ...cached[i]!, tokenUsage: usage };
      await serializedFlush();
      return;
    }
  }
}

async function serializedFlush(): Promise<void> {
  while (flushPromise) {
    await flushPromise;
  }
  flushPromise = flush();
  try {
    await flushPromise;
  } finally {
    flushPromise = null;
  }
}

async function flush(): Promise<void> {
  if (cached.length > MAX_ENTRIES) {
    cached = cached.slice(-MAX_ENTRIES);
  }
  await mkdir(join(homedir(), '.claude-alive'), { recursive: true });
  await writeFile(ARCHIVE_FILE, JSON.stringify(cached, null, 2));
}

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ResumableSession, TerminalMode } from '@claude-alive/core';

/**
 * Disk-persisted registry of UI-spawned Claude sessions. Mirrors the nameStore
 * pattern: a single JSON file under ~/.claude-alive, an in-memory cache, and a
 * serialized flush to avoid write races.
 *
 * Purpose: survive a server restart. When the process dies, every pty dies with
 * it, but the conversation history lives in Claude's own session files. This
 * registry remembers which sessions we owned so the UI can offer to resume them
 * via `claude --resume <claudeSessionId>`.
 */
const STORE_DIR = join(homedir(), '.claude-alive');
const STORE_FILE = join(STORE_DIR, 'managed-sessions.json');
const MAX_SESSIONS = 200;

export interface ManagedSessionRecord {
  tabId: string;
  claudeSessionId: string;
  cwd?: string;
  displayName?: string;
  mode: TerminalMode;
  claudeVariant: 'claude' | 'agents';
  createdAt: number;
  lastActive: number;
}

type RecordMap = Record<string, ManagedSessionRecord>;

let cached: RecordMap = {};
let flushPromise: Promise<void> | null = null;

/** Load the registry from disk. Absent/corrupt file degrades to an empty map. */
export async function loadManagedSessions(): Promise<RecordMap> {
  try {
    const raw = await readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as RecordMap;
    // Defensive: only keep records that still have the required identity fields.
    cached = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.tabId === 'string' && typeof v.claudeSessionId === 'string') {
        cached[k] = v;
      }
    }
  } catch {
    cached = {};
  }
  return cached;
}

/** All persisted records, newest-active first. */
export function getManagedSessions(): ManagedSessionRecord[] {
  return Object.values(cached).sort((a, b) => b.lastActive - a.lastActive);
}

/** Every persisted Claude session UUID — used to repopulate managedSessionIds on boot. */
export function getManagedSessionIds(): string[] {
  return Object.values(cached).map((r) => r.claudeSessionId);
}

/** A single record by tabId, if present. */
export function getManagedSession(tabId: string): ManagedSessionRecord | undefined {
  return cached[tabId];
}

/** Insert or update a record (keyed by tabId), then flush. */
export async function saveManagedSession(record: ManagedSessionRecord): Promise<void> {
  cached[record.tabId] = record;
  await serializedFlush();
}

/** Update lastActive for a tab without a full record rewrite. No-op if unknown. */
export async function touchManagedSession(tabId: string, ts: number): Promise<void> {
  const existing = cached[tabId];
  if (!existing) return;
  cached[tabId] = { ...existing, lastActive: ts };
  await serializedFlush();
}

/** Remove a record (explicit close). No-op if unknown. */
export async function removeManagedSession(tabId: string): Promise<void> {
  if (!(tabId in cached)) return;
  delete cached[tabId];
  await serializedFlush();
}

/** Project the registry into the wire type the UI consumes. */
export function toResumableSessions(): ResumableSession[] {
  return getManagedSessions().map((r) => ({
    tabId: r.tabId,
    claudeSessionId: r.claudeSessionId,
    cwd: r.cwd,
    displayName: r.displayName,
    mode: r.mode,
    claudeVariant: r.claudeVariant,
    lastActive: r.lastActive,
  }));
}

/** Serialize concurrent flush calls to prevent file corruption from races. */
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
  const records = Object.values(cached);
  if (records.length > MAX_SESSIONS) {
    // Keep the most-recently-active MAX_SESSIONS records.
    const keep = records.sort((a, b) => b.lastActive - a.lastActive).slice(0, MAX_SESSIONS);
    const trimmed: RecordMap = {};
    for (const r of keep) trimmed[r.tabId] = r;
    cached = trimmed;
  }
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(cached, null, 2));
}

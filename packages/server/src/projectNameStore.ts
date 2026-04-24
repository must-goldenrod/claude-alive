import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Persistent map of cwd → display name for Claude projects.
 *
 * This is the single source of truth for "what is this project called?". It feeds:
 *   - `claude -n <name>` at spawn time (so /resume picker shows the right name)
 *   - agent.displayName on SessionStart (so the sidebar shows it)
 *   - terminal tab labels (via WS snapshot)
 *
 * Keyed by cwd rather than sessionId because sessions are ephemeral but projects persist.
 */

const NAMES_FILE = join(homedir(), '.claude-alive', 'project-names.json');
const MAX_ENTRIES = 500;

type NameMap = Record<string, string>;

let cached: NameMap = {};
let flushPromise: Promise<void> | null = null;

export async function loadProjectNames(): Promise<NameMap> {
  try {
    const raw = await readFile(NAMES_FILE, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: NameMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      cached = out;
    } else {
      cached = {};
    }
  } catch {
    cached = {};
  }
  return cached;
}

export function getProjectNames(): NameMap {
  return cached;
}

export function getProjectName(cwd: string): string | undefined {
  return cached[cwd];
}

export async function saveProjectName(cwd: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    await removeProjectName(cwd);
    return;
  }
  cached[cwd] = trimmed.slice(0, 100);
  await serializedFlush();
}

export async function removeProjectName(cwd: string): Promise<void> {
  if (cwd in cached) {
    delete cached[cwd];
    await serializedFlush();
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
  const keys = Object.keys(cached);
  if (keys.length > MAX_ENTRIES) {
    const keep = keys.slice(-MAX_ENTRIES);
    const trimmed: NameMap = {};
    for (const k of keep) trimmed[k] = cached[k]!;
    cached = trimmed;
  }
  await mkdir(join(homedir(), '.claude-alive'), { recursive: true });
  await writeFile(NAMES_FILE, JSON.stringify(cached, null, 2));
}

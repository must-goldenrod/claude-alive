import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const NAMES_FILE = join(homedir(), '.claude-alive', 'agent-names.json');
const MAX_NAMES = 500;

type NameMap = Record<string, string>;

let cached: NameMap = {};
let flushPromise: Promise<void> | null = null;

export async function loadNames(): Promise<NameMap> {
  try {
    const raw = await readFile(NAMES_FILE, 'utf-8');
    cached = JSON.parse(raw) as NameMap;
  } catch {
    cached = {};
  }
  return cached;
}

export function getNames(): NameMap {
  return cached;
}

export async function saveName(sessionId: string, name: string): Promise<void> {
  cached[sessionId] = name;
  await serializedFlush();
}

export async function removeName(sessionId: string): Promise<void> {
  delete cached[sessionId];
  await serializedFlush();
}

/** Serialize concurrent flush calls to prevent file corruption from race conditions. */
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
  if (keys.length > MAX_NAMES) {
    const keep = keys.slice(-MAX_NAMES);
    const trimmed: NameMap = {};
    for (const k of keep) trimmed[k] = cached[k]!;
    cached = trimmed;
  }
  await mkdir(join(homedir(), '.claude-alive'), { recursive: true });
  await writeFile(NAMES_FILE, JSON.stringify(cached, null, 2));
}

/**
 * ccusage-style usage extraction from Claude Code's raw JSONL transcripts.
 *
 * Claude Code writes one JSON object per line under ~/.claude/projects/**\/*.jsonl.
 * Assistant messages carry `message.usage` (per-turn token counts) and
 * `message.model`. We fold every assistant message into a normalized
 * {@link UsageRecordDTO}, priced per model, exactly as `ccusage` does:
 *
 *  1. Read all assistant lines across every transcript.
 *  2. Deduplicate by `message.id` + `requestId` — the same message can appear in
 *     multiple files (resumed/branched sessions), and counting it twice inflates
 *     both tokens and cost. This dedup is what makes the total match ccusage.
 *  3. Price each message via {@link costOf} (LiteLLM rates).
 *
 * This is the single source of truth for the Tools > Data dashboard. Because
 * every message is deduped at the source, there is no ticket/session
 * double-counting to reconcile downstream.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { UsageRecordDTO } from '@claude-alive/core';
import { costOf, normalizeModel } from './modelPricing.js';

/** Default transcript root. Overridable for tests via {@link collectUsageRecords}. */
export function defaultProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

const asNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Parse one JSONL line into a usage record, or null when the line is not a
 * usable assistant message. Returns the dedup key alongside the record so the
 * caller can suppress duplicates.
 */
export function parseUsageLine(line: string): { key: string; record: UsageRecordDTO } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null; // fail-soft: a corrupt line must not kill the scan
  }

  if (obj.type !== 'assistant') return null;
  const message = obj.message as Record<string, unknown> | undefined;
  const usage = message?.usage as RawUsage | undefined;
  if (!message || !usage) return null;

  const at = Date.parse(String(obj.timestamp));
  if (Number.isNaN(at)) return null;

  const model = typeof message.model === 'string' ? message.model : 'unknown';
  const input = asNum(usage.input_tokens);
  const output = asNum(usage.output_tokens);
  const cacheCreation = asNum(usage.cache_creation_input_tokens);
  const cacheRead = asNum(usage.cache_read_input_tokens);
  const totalTokens = input + output + cacheCreation + cacheRead;
  if (totalTokens <= 0) return null;

  const costUsd = costOf({ input, output, cacheCreation, cacheRead }, model);

  // Dedup on message id + request id. When either is missing, fall back to a
  // uuid so the record is still counted (never silently dropped).
  const id = typeof message.id === 'string' ? message.id : '';
  const req = typeof obj.requestId === 'string' ? obj.requestId : '';
  const key = id || req ? `${id}:${req}` : `uuid:${String(obj.uuid ?? at + ':' + totalTokens)}`;

  return {
    key,
    record: {
      at,
      model: normalizeModel(model),
      inputTokens: input,
      outputTokens: output,
      cacheTokens: cacheCreation + cacheRead,
      totalTokens,
      costUsd,
      calls: 1,
    },
  };
}

/** Recursively list every `.jsonl` file under `dir`. */
async function listJsonlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // missing dir → no data, not an error
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listJsonlFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scan all transcripts under `dir` and return deduped, priced usage records.
 * A file that fails to read is skipped (one bad file must not fail the scan).
 */
export async function collectUsageRecords(dir: string = defaultProjectsDir()): Promise<UsageRecordDTO[]> {
  const files = await listJsonlFiles(dir);
  const seen = new Set<string>();
  const records: UsageRecordDTO[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, 'utf-8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const parsed = parseUsageLine(line);
      if (!parsed) continue;
      if (seen.has(parsed.key)) continue;
      seen.add(parsed.key);
      records.push(parsed.record);
    }
  }
  return records;
}

/**
 * Cached view over {@link collectUsageRecords}. The scan touches hundreds of
 * files, so a short TTL keeps the dashboard responsive without serving stale
 * data (usage grows slowly relative to a 15s window).
 */
export function createUsageRecordsCache(opts: { dir?: string; ttlMs?: number; now?: () => number } = {}) {
  const dir = opts.dir ?? defaultProjectsDir();
  const ttlMs = opts.ttlMs ?? 15_000;
  const now = opts.now ?? Date.now;
  let cache: { at: number; records: UsageRecordDTO[] } | null = null;
  let inflight: Promise<UsageRecordDTO[]> | null = null;

  return {
    async get(): Promise<UsageRecordDTO[]> {
      if (cache && now() - cache.at < ttlMs) return cache.records;
      if (inflight) return inflight;
      inflight = collectUsageRecords(dir)
        .then((records) => {
          cache = { at: now(), records };
          return records;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}

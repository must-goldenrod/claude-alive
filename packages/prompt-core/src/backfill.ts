/**
 * Claude Code history backfill — scans `~/.claude/projects/**\/*.jsonl` and
 * reports how many user prompts are there, how many are already present in
 * the Think-Prompt DB, and how many would be new imports.
 *
 * Also exposes `importClaudeHistory` to actually write those prompts into
 * the local DB (used by `think-prompt backfill --execute`). Import runs
 * the same rule engine as live capture, so tiers/scores come out consistent.
 *
 * Layout observed on macOS:
 *   ~/.claude/projects/
 *     -Users-alice-repo/                 ← cwd-encoded path segment
 *       <session-uuid>.jsonl             ← one session transcript
 *       <another-uuid>.jsonl
 *
 * Schema of a `type: "user"` entry (confirmed from live data):
 *   {
 *     type: "user",
 *     message: { role: "user", content: "<string>" | <content-block-array> },
 *     sessionId: "<uuid>",
 *     timestamp: "2026-04-15T11:21:54.972Z",
 *     cwd: "/Users/alice/repo",
 *     gitBranch: "main",
 *     version: "2.1.109",
 *     ...
 *   }
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Database as Db } from 'better-sqlite3';
import { insertPromptUsage, insertRuleHit, upsertQualityScore, upsertSession } from './db.js';
import { composeFinalScore, computeRuleScore } from './scorer.js';

export interface BackfillScanOptions {
  /** Override the Claude projects root. Default: `~/.claude/projects`. */
  root?: string;
  /** Stop after scanning this many .jsonl files (0 = no limit). */
  limit?: number;
  /** Skip prompts older than this ISO date string. */
  since?: string;
  /** Only scan sessions whose cwd contains this substring. */
  projectFilter?: string;
}

export interface BackfillCandidate {
  /** Original Claude sessionId (UUID). */
  sessionId: string;
  /** Working directory recorded at capture time. */
  cwd: string;
  /** ISO timestamp from the JSONL entry. */
  timestamp: string;
  /** User prompt text, content array flattened to string if needed. */
  promptText: string;
  /** SHA-256 of promptText, hex. Used to dedupe against DB. */
  promptHash: string;
  /** File path the candidate came from (for debugging). */
  sourceFile: string;
}

export interface BackfillStats {
  /** Root directory that was scanned. */
  root: string;
  /** Whether the root existed. */
  rootExists: boolean;
  /** Number of .jsonl files we touched. */
  filesScanned: number;
  /** Number of .jsonl files that had at least one user prompt. */
  filesWithPrompts: number;
  /** Files we tried to read but could not parse a single entry from. */
  filesFailed: number;
  /** Raw count of `type: "user"` entries found. */
  totalUserEntries: number;
  /** Entries whose `message.content` yielded a non-empty text. */
  extractablePrompts: number;
  /** Prompts whose hash is already present in prompt_usages. */
  alreadyInDb: number;
  /** Prompts that would be imported if --execute ran today. */
  newPrompts: number;
  /** Prompts skipped because of --since cutoff. */
  skippedBySince: number;
  /** Distinct sessionIds observed. */
  distinctSessions: number;
  /** Earliest timestamp seen (for the UI "data goes back to …"). */
  earliestTimestamp: string | null;
  /** Latest timestamp seen. */
  latestTimestamp: string | null;
}

/**
 * Walk the Claude projects directory and compute import statistics.
 * Does NOT write to the DB; takes an optional `db` to check for duplicates.
 */
export function scanClaudeHistory(db: Db | null, opts: BackfillScanOptions = {}): BackfillStats {
  const root = opts.root ?? join(homedir(), '.claude', 'projects');

  const stats: BackfillStats = {
    root,
    rootExists: existsSync(root),
    filesScanned: 0,
    filesWithPrompts: 0,
    filesFailed: 0,
    totalUserEntries: 0,
    extractablePrompts: 0,
    alreadyInDb: 0,
    newPrompts: 0,
    skippedBySince: 0,
    distinctSessions: 0,
    earliestTimestamp: null,
    latestTimestamp: null,
  };

  if (!stats.rootExists) return stats;

  // Collect .jsonl paths up-front so the caller can reason about totals
  // before we start streaming. At ~1,000 sessions this is cheap.
  const files = collectJsonlFiles(root, opts.projectFilter);
  const cap = opts.limit && opts.limit > 0 ? Math.min(files.length, opts.limit) : files.length;

  // Cache of all prompt_hashes currently in the DB so we do one SELECT not
  // N SELECTs. O(N) memory but N is our OWN row count, usually small
  // relative to the history being imported.
  const hashSet = loadExistingHashes(db);

  const sessionSet = new Set<string>();

  for (let i = 0; i < cap; i++) {
    const path = files[i];
    if (!path) continue;
    stats.filesScanned++;

    const perFile = scanFile(path, opts.since);
    if (perFile.failed) {
      stats.filesFailed++;
      continue;
    }
    if (perFile.prompts.length > 0) stats.filesWithPrompts++;
    stats.totalUserEntries += perFile.userEntries;
    stats.skippedBySince += perFile.skippedBySince;

    for (const c of perFile.prompts) {
      stats.extractablePrompts++;
      sessionSet.add(c.sessionId);
      if (hashSet.has(c.promptHash)) {
        stats.alreadyInDb++;
      } else {
        stats.newPrompts++;
      }
      if (!stats.earliestTimestamp || c.timestamp < stats.earliestTimestamp) {
        stats.earliestTimestamp = c.timestamp;
      }
      if (!stats.latestTimestamp || c.timestamp > stats.latestTimestamp) {
        stats.latestTimestamp = c.timestamp;
      }
    }
  }

  stats.distinctSessions = sessionSet.size;
  return stats;
}

/**
 * Enumerate one .jsonl at a time so a caller can build a streaming importer
 * later without re-implementing this walk. Yields relative & absolute paths.
 */
export function* iterateClaudeJsonl(
  root = join(homedir(), '.claude', 'projects')
): Generator<string> {
  if (!existsSync(root)) return;
  for (const p of collectJsonlFiles(root)) yield p;
}

/**
 * Parse one JSONL file and return candidates. Exported for tests + the
 * future --execute path that will feed these into insertPromptUsage.
 */
export function parseSessionFile(
  path: string,
  since?: string
): { failed: boolean; userEntries: number; skippedBySince: number; prompts: BackfillCandidate[] } {
  return scanFile(path, since);
}

// ---------------- internals ---------------------------------------------

function collectJsonlFiles(root: string, projectFilter?: string): string[] {
  const out: string[] = [];
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(root).map((d) => join(root, d));
  } catch {
    return out;
  }
  for (const dir of projectDirs) {
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    if (projectFilter && !dir.includes(projectFilter)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.endsWith('.jsonl')) out.push(join(dir, e));
    }
  }
  // Deterministic order for testability.
  out.sort();
  return out;
}

function scanFile(
  path: string,
  since?: string
): { failed: boolean; userEntries: number; skippedBySince: number; prompts: BackfillCandidate[] } {
  const sinceTs = since ? normalizeIsoDate(since) : null;
  const prompts: BackfillCandidate[] = [];
  let userEntries = 0;
  let skippedBySince = 0;

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { failed: true, userEntries: 0, skippedBySince: 0, prompts };
  }

  // Stream line-by-line so a 50 MB session file doesn't blow memory into
  // a single giant JSON blob in a retained array. (The file is still
  // read into memory once — that's unavoidable with synchronous fs.)
  const lines = text.split('\n');
  let parsedAny = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
      parsedAny = true;
    } catch {
      continue;
    }
    if (obj.type !== 'user') continue;
    userEntries++;

    const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : undefined;
    if (!timestamp) continue;
    if (sinceTs && timestamp < sinceTs) {
      skippedBySince++;
      continue;
    }

    const sessionId = typeof obj.sessionId === 'string' ? obj.sessionId : '';
    const cwd = typeof obj.cwd === 'string' ? obj.cwd : '';
    if (!sessionId || !cwd) continue;

    const promptText = extractUserText(obj);
    if (!promptText) continue;

    prompts.push({
      sessionId,
      cwd,
      timestamp,
      promptText,
      promptHash: sha256Hex(promptText),
      sourceFile: path,
    });
  }

  return { failed: !parsedAny, userEntries, skippedBySince, prompts };
}

function extractUserText(entry: Record<string, unknown>): string | null {
  const message = (entry.message ?? entry) as Record<string, unknown>;
  const content = message.content ?? entry.content;
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === 'string') parts.push(item);
      else if (item && typeof item === 'object') {
        const t = (item as Record<string, unknown>).text;
        if (typeof t === 'string') parts.push(t);
      }
    }
    const joined = parts.join('\n').trim();
    return joined.length > 0 ? joined : null;
  }
  return null;
}

function loadExistingHashes(db: Db | null): Set<string> {
  const out = new Set<string>();
  if (!db) return out;
  try {
    const rows = db
      .prepare(`SELECT prompt_hash FROM prompt_usages WHERE prompt_hash IS NOT NULL`)
      .all() as Array<{ prompt_hash: string | null }>;
    for (const r of rows) {
      if (r.prompt_hash) out.add(r.prompt_hash);
    }
  } catch {
    // Schema mismatch or missing table — return empty set and treat
    // everything as new.
  }
  return out;
}

function normalizeIsoDate(raw: string): string {
  // Accept `YYYY-MM-DD` and produce an ISO instant for lexicographic compare.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
  return raw;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// ----------------------- import (--execute) ------------------------------

/** Signature of `runRules` from @think-prompt/rules. Kept loose here to avoid
 *  a hard dependency edge from core → rules (core is the lower layer). */
export type RunRulesFn = (ctx: {
  promptText: string;
  session: { cwd: string };
  meta: { charLen: number; wordCount: number; piiHits?: Record<string, number> };
}) => Array<{
  ruleId: string;
  ruleName: string;
  severity: number;
  message: string;
  evidence?: string | null;
}>;

export interface ImportProgress {
  totalCandidates: number;
  processed: number;
  imported: number;
  skippedDup: number;
  failed: number;
  currentSession: string;
}

export interface ImportOptions extends BackfillScanOptions {
  /** Inject the rules runner so core stays decoupled from the rules package. */
  runRules: RunRulesFn;
  /** Transaction batch size. Default 500. */
  batchSize?: number;
  /** Optional progress callback (every completed batch). */
  onProgress?: (p: ImportProgress) => void;
}

export interface ImportResult {
  filesScanned: number;
  filesFailed: number;
  totalCandidates: number;
  imported: number;
  skippedDup: number;
  failed: number;
  distinctSessions: number;
  durationMs: number;
}

/**
 * Write every new historical prompt into the local DB, running the same
 * rule scorer as live capture so tiers/scores are consistent with
 * hook-collected data.
 *
 * Idempotent: re-running is safe — `prompt_hash` dedup catches anything
 * that was imported on a previous run. Crashes mid-run lose at most
 * `batchSize-1` rows (transaction rollback).
 */
export function importClaudeHistory(db: Db, opts: ImportOptions): ImportResult {
  const t0 = Date.now();
  const root = opts.root ?? join(homedir(), '.claude', 'projects');
  const batchSize = opts.batchSize ?? 500;

  const result: ImportResult = {
    filesScanned: 0,
    filesFailed: 0,
    totalCandidates: 0,
    imported: 0,
    skippedDup: 0,
    failed: 0,
    distinctSessions: 0,
    durationMs: 0,
  };

  if (!existsSync(root)) {
    result.durationMs = Date.now() - t0;
    return result;
  }

  const files = collectJsonlFiles(root, opts.projectFilter);
  const cap = opts.limit && opts.limit > 0 ? Math.min(files.length, opts.limit) : files.length;

  // Pre-load hash set once. Subsequent dedup within this run is memory-only.
  const hashSet = loadExistingHashes(db);
  const sessionSet = new Set<string>();
  const sessionCwdMap = new Map<string, string>();

  // Gather all candidates first so we can chunk + transaction nicely.
  // Memory impact: each candidate is ~1 KB average × 100k = ~100 MB.
  // If that becomes a concern we can stream file-by-file.
  const candidates: BackfillCandidate[] = [];
  for (let i = 0; i < cap; i++) {
    const path = files[i];
    if (!path) continue;
    result.filesScanned++;
    const { failed, prompts } = scanFile(path, opts.since);
    if (failed) {
      result.filesFailed++;
      continue;
    }
    for (const c of prompts) {
      if (hashSet.has(c.promptHash)) {
        result.skippedDup++;
        continue;
      }
      hashSet.add(c.promptHash); // dedup within this run too
      sessionCwdMap.set(c.sessionId, c.cwd);
      candidates.push(c);
    }
  }
  result.totalCandidates = candidates.length;

  // Chronological order per session so turn_index increments correctly.
  candidates.sort((a, b) => {
    if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
    return a.timestamp < b.timestamp ? -1 : 1;
  });

  // Upfront: upsert sessions (one row per distinct sessionId) in a single tx.
  const upsertSessions = db.transaction(() => {
    for (const [sid, cwd] of sessionCwdMap) {
      upsertSession(db, { id: sid, cwd, source: 'claude-code-backfill' });
      sessionSet.add(sid);
    }
  });
  upsertSessions();
  result.distinctSessions = sessionSet.size;

  // Process candidates in batches, each batch its own transaction.
  const insertBatch = db.transaction((items: BackfillCandidate[]) => {
    for (const c of items) {
      try {
        const usage = insertPromptUsage(db, {
          session_id: c.sessionId,
          prompt_text: c.promptText,
          created_at: c.timestamp,
        });
        const hits = opts.runRules({
          promptText: c.promptText,
          session: { cwd: c.cwd },
          meta: { charLen: usage.char_len, wordCount: usage.word_count },
        });
        for (const h of hits) {
          insertRuleHit(db, {
            usage_id: usage.id,
            rule_id: h.ruleId,
            severity: h.severity,
            message: h.message,
            evidence: h.evidence ?? undefined,
          });
        }
        const ruleScore = computeRuleScore(hits);
        const { final_score, tier } = composeFinalScore({
          rule_score: ruleScore,
          usage_score: null,
          judge_score: null,
        });
        upsertQualityScore(db, {
          usage_id: usage.id,
          rule_score: ruleScore,
          final_score,
          tier,
          rules_version: 1,
        });
        result.imported++;
      } catch {
        // Individual prompt failures (FK constraint, schema drift, malformed
        // text) drop in 1 attempt instead of rolling back the whole batch.
        result.failed++;
      }
    }
  });

  for (let i = 0; i < candidates.length; i += batchSize) {
    const chunk = candidates.slice(i, i + batchSize);
    insertBatch(chunk);
    if (opts.onProgress) {
      opts.onProgress({
        totalCandidates: candidates.length,
        processed: Math.min(i + batchSize, candidates.length),
        imported: result.imported,
        skippedDup: result.skippedDup,
        failed: result.failed,
        currentSession: chunk[chunk.length - 1]?.sessionId ?? '',
      });
    }
  }

  result.durationMs = Date.now() - t0;
  return result;
}

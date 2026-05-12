import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import Database, { type Database as Db } from 'better-sqlite3';
import { detectLanguage } from './lang.js';
import {
  MIGRATION_001,
  MIGRATION_002,
  MIGRATION_003,
  MIGRATION_004,
  MIGRATION_005,
  MIGRATION_006,
} from './migrations/sql.js';
import { getPaths } from './paths.js';
import { maskPii } from './pii.js';
import { ulid } from './ulid.js';

const CURRENT_SCHEMA_VERSION = 6;

export function openDb(rootOverride?: string): Db {
  const paths = getPaths(rootOverride);
  mkdirSync(paths.root, { recursive: true });
  const db = new Database(paths.dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function runMigrations(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const row = db.prepare(`SELECT value FROM _meta WHERE key='schema_version'`).get() as
    | { value: string }
    | undefined;
  const current = row ? Number.parseInt(row.value, 10) : 0;
  const migrations: Array<{ v: number; sql: string }> = [
    { v: 1, sql: MIGRATION_001 },
    { v: 2, sql: MIGRATION_002 },
    { v: 3, sql: MIGRATION_003 },
    { v: 4, sql: MIGRATION_004 },
    { v: 5, sql: MIGRATION_005 },
    { v: 6, sql: MIGRATION_006 },
  ];
  for (const m of migrations) {
    if (m.v <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare(`INSERT OR REPLACE INTO _meta(key,value) VALUES ('schema_version', ?)`).run(
        String(m.v)
      );
    })();
  }
  if (db.prepare(`SELECT value FROM _meta WHERE key='installed_at'`).get() == null) {
    db.prepare(`INSERT OR IGNORE INTO _meta(key,value) VALUES ('installed_at', ?)`).run(
      new Date().toISOString()
    );
  }
  if (current < CURRENT_SCHEMA_VERSION) {
    // nothing else to do here; kept for future migrations
  }
}

// --- Repository-ish functions ---

export interface SessionRow {
  id: string;
  cwd: string;
  model: string | null;
  source: string | null;
  started_at: string;
  ended_at: string | null;
  transcript_path: string | null;
  stop_count: number;
}

export interface PromptUsageRow {
  id: string;
  session_id: string;
  prompt_text: string;
  prompt_hash: string;
  pii_masked: string;
  pii_hits: string | null;
  char_len: number;
  word_count: number;
  created_at: string;
  turn_index: number;
  coach_context: string | null;
  detected_language: string | null;
  browser_session_id: string | null;
}

export function upsertSession(
  db: Db,
  s: {
    id: string;
    cwd: string;
    model?: string | null;
    source?: string | null;
    transcript_path?: string | null;
  }
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions(id, cwd, model, source, started_at, transcript_path)
     VALUES (@id, @cwd, @model, COALESCE(@source, 'claude-code'), @started_at, @transcript_path)
     ON CONFLICT(id) DO UPDATE SET
       cwd=COALESCE(excluded.cwd, sessions.cwd),
       model=COALESCE(excluded.model, sessions.model),
       source=COALESCE(excluded.source, sessions.source),
       transcript_path=COALESCE(excluded.transcript_path, sessions.transcript_path)`
  ).run({
    id: s.id,
    cwd: s.cwd,
    model: s.model ?? null,
    source: s.source ?? null,
    started_at: now,
    transcript_path: s.transcript_path ?? null,
  });
}

export function endSession(db: Db, sessionId: string): void {
  db.prepare(
    `UPDATE sessions SET ended_at=COALESCE(ended_at, ?), stop_count=stop_count+1 WHERE id=?`
  ).run(new Date().toISOString(), sessionId);
}

export interface InsertPromptUsageInput {
  session_id: string;
  prompt_text: string;
  turn_index?: number;
  coach_context?: string | null;
  browser_session_id?: string | null;
  /**
   * ISO timestamp to persist as `created_at`. Defaults to "now".
   * Used by the Claude history backfill to preserve original capture times
   * instead of stamping every imported prompt with today's date.
   */
  created_at?: string;
}

export function insertPromptUsage(db: Db, input: InsertPromptUsageInput): PromptUsageRow {
  const id = ulid();
  const createdAt = input.created_at ?? new Date().toISOString();
  const hash = sha256Hex(input.prompt_text);
  const { masked, hits } = maskPii(input.prompt_text);
  const wordCount = input.prompt_text.trim().split(/\s+/).filter(Boolean).length;
  const charLen = input.prompt_text.length;

  let turnIndex = input.turn_index;
  if (turnIndex == null) {
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(turn_index), -1) AS max_ti FROM prompt_usages WHERE session_id = ?`
      )
      .get(input.session_id) as { max_ti: number };
    turnIndex = row.max_ti + 1;
  }

  const language = detectLanguage(input.prompt_text);

  db.prepare(
    `INSERT INTO prompt_usages(id, session_id, prompt_text, prompt_hash, pii_masked, pii_hits,
                                char_len, word_count, created_at, turn_index, coach_context,
                                detected_language, browser_session_id)
     VALUES (@id,@session_id,@prompt_text,@prompt_hash,@pii_masked,@pii_hits,
             @char_len,@word_count,@created_at,@turn_index,@coach_context,
             @detected_language,@browser_session_id)`
  ).run({
    id,
    session_id: input.session_id,
    prompt_text: input.prompt_text,
    prompt_hash: hash,
    pii_masked: masked,
    pii_hits: JSON.stringify(hits),
    char_len: charLen,
    word_count: wordCount,
    created_at: createdAt,
    turn_index: turnIndex,
    coach_context: input.coach_context ?? null,
    detected_language: language,
    browser_session_id: input.browser_session_id ?? null,
  });

  return {
    id,
    session_id: input.session_id,
    prompt_text: input.prompt_text,
    prompt_hash: hash,
    pii_masked: masked,
    pii_hits: JSON.stringify(hits),
    char_len: charLen,
    word_count: wordCount,
    created_at: createdAt,
    turn_index: turnIndex,
    coach_context: input.coach_context ?? null,
    detected_language: language,
    browser_session_id: input.browser_session_id ?? null,
  };
}

export function insertRuleHit(
  db: Db,
  hit: {
    usage_id: string;
    rule_id: string;
    severity: number;
    message: string;
    evidence?: string | null | undefined;
  }
): void {
  db.prepare(
    `INSERT OR REPLACE INTO rule_hits(usage_id, rule_id, severity, message, evidence)
     VALUES (@usage_id, @rule_id, @severity, @message, @evidence)`
  ).run({
    usage_id: hit.usage_id,
    rule_id: hit.rule_id,
    severity: hit.severity,
    message: hit.message,
    evidence: hit.evidence ?? null,
  });
}

export interface QualityScoreInput {
  usage_id: string;
  rule_score: number;
  usage_score?: number | null;
  judge_score?: number | null;
  final_score: number;
  tier: 'good' | 'ok' | 'weak' | 'bad';
  rules_version: number;
  /** D-046: extra columns — nullable so legacy callers don't have to know about them yet. */
  efficiency_score?: number | null;
  bonus_score?: number | null;
  cap_applied?: number | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  baseline_delta?: number | null;
}

export function upsertQualityScore(db: Db, s: QualityScoreInput): void {
  db.prepare(
    `INSERT INTO quality_scores(usage_id, rule_score, usage_score, judge_score, final_score, tier,
                                computed_at, rules_version,
                                efficiency_score, bonus_score, cap_applied, confidence, baseline_delta)
     VALUES (@usage_id,@rule_score,@usage_score,@judge_score,@final_score,@tier,
             @computed_at,@rules_version,
             @efficiency_score,@bonus_score,@cap_applied,@confidence,@baseline_delta)
     ON CONFLICT(usage_id) DO UPDATE SET
       rule_score=excluded.rule_score,
       usage_score=COALESCE(excluded.usage_score, quality_scores.usage_score),
       judge_score=COALESCE(excluded.judge_score, quality_scores.judge_score),
       final_score=excluded.final_score,
       tier=excluded.tier,
       computed_at=excluded.computed_at,
       rules_version=excluded.rules_version,
       efficiency_score=COALESCE(excluded.efficiency_score, quality_scores.efficiency_score),
       bonus_score=COALESCE(excluded.bonus_score, quality_scores.bonus_score),
       cap_applied=COALESCE(excluded.cap_applied, quality_scores.cap_applied),
       confidence=COALESCE(excluded.confidence, quality_scores.confidence),
       baseline_delta=COALESCE(excluded.baseline_delta, quality_scores.baseline_delta)`
  ).run({
    ...s,
    usage_score: s.usage_score ?? null,
    judge_score: s.judge_score ?? null,
    efficiency_score: s.efficiency_score ?? null,
    bonus_score: s.bonus_score ?? null,
    cap_applied: s.cap_applied ?? null,
    confidence: s.confidence ?? null,
    baseline_delta: s.baseline_delta ?? null,
    computed_at: new Date().toISOString(),
  });
}

/**
 * Persist per-turn efficiency features extracted by the worker from the
 * transcript. Columns added by MIGRATION_006 (all nullable).
 */
export function updateUsageEfficiencyFeatures(
  db: Db,
  usage_id: string,
  f: {
    first_shot_success?: number | null;
    tool_call_count?: number | null;
    follow_up_depth?: number | null;
  }
): void {
  db.prepare(
    `UPDATE prompt_usages SET
       first_shot_success = COALESCE(?, first_shot_success),
       tool_call_count    = COALESCE(?, tool_call_count),
       follow_up_depth    = COALESCE(?, follow_up_depth)
     WHERE id = ?`
  ).run(
    f.first_shot_success ?? null,
    f.tool_call_count ?? null,
    f.follow_up_depth ?? null,
    usage_id
  );
}

export interface BaselineSnapshotRow {
  id: string;
  scope: string;
  window_days: number;
  computed_at: string;
  sample_size: number;
  avg_final_score: number;
  avg_word_count: number;
  avg_severity_hits: number;
}

/** Compute and persist the rolling-window baseline. Returns the row if sample was large enough,
 *  null if below the minimum sample threshold (cold-start). */
export function recomputeBaseline(
  db: Db,
  opts: { scope?: string; windowDays?: number; minSamples?: number } = {}
): BaselineSnapshotRow | null {
  const scope = opts.scope ?? 'global';
  const windowDays = opts.windowDays ?? 30;
  const minSamples = opts.minSamples ?? 50;

  const row = db
    .prepare(
      `SELECT COUNT(*) AS n,
              AVG(q.final_score) AS avg_final,
              AVG(u.word_count) AS avg_words,
              AVG((SELECT COUNT(*) FROM rule_hits h WHERE h.usage_id = u.id AND h.severity >= 3)) AS avg_sev
         FROM quality_scores q
         JOIN prompt_usages u ON u.id = q.usage_id
        WHERE u.created_at >= datetime('now', ?)`
    )
    .get(`-${windowDays} days`) as {
    n: number;
    avg_final: number | null;
    avg_words: number | null;
    avg_sev: number | null;
  };

  if (row.n < minSamples) return null;

  const id = ulid();
  const computed_at = new Date().toISOString();
  const snap: BaselineSnapshotRow = {
    id,
    scope,
    window_days: windowDays,
    computed_at,
    sample_size: row.n,
    avg_final_score: row.avg_final ?? 0,
    avg_word_count: row.avg_words ?? 0,
    avg_severity_hits: row.avg_sev ?? 0,
  };
  db.prepare(
    `INSERT INTO user_baseline_snapshots(id, scope, window_days, computed_at, sample_size,
                                          avg_final_score, avg_word_count, avg_severity_hits, snapshot_json)
     VALUES (@id,@scope,@window_days,@computed_at,@sample_size,
             @avg_final_score,@avg_word_count,@avg_severity_hits,NULL)`
  ).run(snap);
  return snap;
}

export function getLatestBaseline(db: Db, scope = 'global'): BaselineSnapshotRow | null {
  const row = db
    .prepare(
      `SELECT * FROM user_baseline_snapshots WHERE scope = ? ORDER BY computed_at DESC LIMIT 1`
    )
    .get(scope) as BaselineSnapshotRow | undefined;
  return row ?? null;
}

export function upsertSubagent(
  db: Db,
  s: {
    session_id: string;
    agent_type: string;
    agent_id: string;
    parent_usage_id?: string | null;
    transcript_path?: string | null;
  }
): string {
  // Use composite key (session_id, agent_id) for idempotency.
  const existing = db
    .prepare(`SELECT id FROM subagent_invocations WHERE session_id=? AND agent_id=?`)
    .get(s.session_id, s.agent_id) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = ulid();
  db.prepare(
    `INSERT INTO subagent_invocations(id, session_id, parent_usage_id, agent_type, agent_id, started_at, transcript_path, status)
     VALUES (?,?,?,?,?,?,?, 'running')`
  ).run(
    id,
    s.session_id,
    s.parent_usage_id ?? null,
    s.agent_type,
    s.agent_id,
    new Date().toISOString(),
    s.transcript_path ?? null
  );
  return id;
}

export function finishSubagent(
  db: Db,
  session_id: string,
  agent_id: string,
  patch: {
    transcript_path?: string | null;
    prompt_text?: string | null;
    response_text?: string | null;
  }
): void {
  const sets: string[] = ['ended_at=?', 'status=?'];
  const args: unknown[] = [new Date().toISOString(), 'completed'];
  if (patch.transcript_path !== undefined) {
    sets.push('transcript_path=?');
    args.push(patch.transcript_path);
  }
  if (patch.prompt_text !== undefined) {
    sets.push('prompt_text=?');
    sets.push('prompt_hash=?');
    args.push(patch.prompt_text);
    args.push(patch.prompt_text == null ? null : sha256Hex(patch.prompt_text));
  }
  if (patch.response_text !== undefined) {
    sets.push('response_text=?');
    args.push(patch.response_text);
  }
  args.push(session_id, agent_id);
  db.prepare(
    `UPDATE subagent_invocations SET ${sets.join(', ')} WHERE session_id=? AND agent_id=?`
  ).run(...args);
}

export function bumpToolRollup(
  db: Db,
  v: {
    session_id: string;
    tool_name: string;
    failed: boolean;
    ms: number;
    in_bytes: number;
    out_bytes: number;
  }
): void {
  db.prepare(
    `INSERT INTO tool_use_rollups(session_id, tool_name, call_count, fail_count, total_ms, total_in_bytes, total_out_bytes)
     VALUES (?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(session_id, tool_name) DO UPDATE SET
       call_count = call_count + 1,
       fail_count = fail_count + ?,
       total_ms = total_ms + ?,
       total_in_bytes = total_in_bytes + ?,
       total_out_bytes = total_out_bytes + ?`
  ).run(
    v.session_id,
    v.tool_name,
    v.failed ? 1 : 0,
    v.ms,
    v.in_bytes,
    v.out_bytes,
    v.failed ? 1 : 0,
    v.ms,
    v.in_bytes,
    v.out_bytes
  );
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare(`SELECT value FROM _meta WHERE key=?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(`INSERT OR REPLACE INTO _meta(key,value) VALUES (?,?)`).run(key, value);
}

// --- User feedback (C-044 / C-047 / usage_score input) ---

export type OutcomeRating = 'up' | 'down';

export interface OutcomeRow {
  id: string;
  usage_id: string;
  rating: OutcomeRating;
  note: string | null;
  created_at: string;
}

export function recordOutcome(
  db: Db,
  usage_id: string,
  rating: OutcomeRating,
  note?: string | null
): OutcomeRow {
  const id = ulid();
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO outcomes(id, usage_id, rating, note, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, usage_id, rating, note ?? null, created_at);
  return { id, usage_id, rating, note: note ?? null, created_at };
}

/**
 * Aggregates feedback for a prompt into {ups, downs}. Used by the scorer
 * when computing usage_score for the 0.25 feedback weight.
 */
export function getOutcomeTotals(db: Db, usage_id: string): { ups: number; downs: number } {
  const row = db
    .prepare(
      `SELECT
          SUM(CASE WHEN rating='up'   THEN 1 ELSE 0 END) AS ups,
          SUM(CASE WHEN rating='down' THEN 1 ELSE 0 END) AS downs
         FROM outcomes WHERE usage_id = ?`
    )
    .get(usage_id) as { ups: number | null; downs: number | null };
  return { ups: row.ups ?? 0, downs: row.downs ?? 0 };
}

/* ---------------- deep_analyses ---------------------------------------- */

export interface DeepAnalysisProblem {
  category: string;
  severity: number;
  explanation: string;
}

export interface DeepAnalysisRow {
  id: string;
  usage_id: string;
  model: string;
  status: string;
  problems: DeepAnalysisProblem[];
  reasoning: string[];
  after_text: string;
  applied_fixes: string[];
  input_tokens: number | null;
  output_tokens: number | null;
  error_message: string | null;
  created_at: string;
}

export interface InsertDeepAnalysisInput {
  usage_id: string;
  model: string;
  status: 'ok' | 'failed';
  problems: DeepAnalysisProblem[];
  reasoning: string[];
  after_text: string;
  applied_fixes?: string[];
  input_tokens?: number;
  output_tokens?: number;
  error_message?: string;
}

/** Persist a deep analysis result. Caller handles LLM errors above. */
export function insertDeepAnalysis(db: Db, input: InsertDeepAnalysisInput): DeepAnalysisRow {
  const id = ulid();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO deep_analyses(id, usage_id, model, status, problems_json, reasoning_json,
                                after_text, applied_fixes, input_tokens, output_tokens,
                                error_message, created_at)
     VALUES (@id, @usage_id, @model, @status, @problems_json, @reasoning_json,
             @after_text, @applied_fixes, @input_tokens, @output_tokens,
             @error_message, @created_at)`
  ).run({
    id,
    usage_id: input.usage_id,
    model: input.model,
    status: input.status,
    problems_json: JSON.stringify(input.problems),
    reasoning_json: JSON.stringify(input.reasoning),
    after_text: input.after_text,
    applied_fixes: JSON.stringify(input.applied_fixes ?? []),
    input_tokens: input.input_tokens ?? null,
    output_tokens: input.output_tokens ?? null,
    error_message: input.error_message ?? null,
    created_at: createdAt,
  });
  return {
    id,
    usage_id: input.usage_id,
    model: input.model,
    status: input.status,
    problems: input.problems,
    reasoning: input.reasoning,
    after_text: input.after_text,
    applied_fixes: input.applied_fixes ?? [],
    input_tokens: input.input_tokens ?? null,
    output_tokens: input.output_tokens ?? null,
    error_message: input.error_message ?? null,
    created_at: createdAt,
  };
}

/** Fetch the deep-analysis history for one prompt usage, newest first.
 *  The `id DESC` tiebreaker makes the order deterministic even when two
 *  inserts land in the same millisecond (ULIDs embed a monotonic counter). */
export function getDeepAnalyses(db: Db, usage_id: string): DeepAnalysisRow[] {
  const rows = db
    .prepare(`SELECT * FROM deep_analyses WHERE usage_id=? ORDER BY created_at DESC, id DESC`)
    .all(usage_id) as Array<{
    id: string;
    usage_id: string;
    model: string;
    status: string;
    problems_json: string;
    reasoning_json: string;
    after_text: string;
    applied_fixes: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    error_message: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    usage_id: r.usage_id,
    model: r.model,
    status: r.status,
    problems: safeJsonParse<DeepAnalysisProblem[]>(r.problems_json, []),
    reasoning: safeJsonParse<string[]>(r.reasoning_json, []),
    after_text: r.after_text,
    applied_fixes: safeJsonParse<string[]>(r.applied_fixes ?? '[]', []),
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    error_message: r.error_message,
    created_at: r.created_at,
  }));
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

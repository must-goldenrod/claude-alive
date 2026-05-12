// Inline SQL migrations so they don't rely on files being copied to dist/.
// Kept in sync with src/migrations/NNN_*.sql.

/**
 * v1 schema. Additive changes must go into their own MIGRATION_NNN constant.
 */
export const MIGRATION_001: string = `
CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  cwd             TEXT NOT NULL,
  model           TEXT,
  source          TEXT,
  started_at      DATETIME NOT NULL,
  ended_at        DATETIME,
  transcript_path TEXT,
  stop_count      INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS prompt_usages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  prompt_text   TEXT NOT NULL,
  prompt_hash   TEXT NOT NULL,
  pii_masked    TEXT NOT NULL,
  pii_hits      TEXT,
  char_len      INTEGER NOT NULL,
  word_count    INTEGER NOT NULL,
  created_at    DATETIME NOT NULL,
  turn_index    INTEGER NOT NULL,
  coach_context TEXT
);
CREATE INDEX IF NOT EXISTS idx_pu_session ON prompt_usages(session_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_pu_hash ON prompt_usages(prompt_hash);
CREATE INDEX IF NOT EXISTS idx_pu_created ON prompt_usages(created_at DESC);

CREATE TABLE IF NOT EXISTS prompts (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  current_ver   INTEGER NOT NULL DEFAULT 1,
  first_seen    DATETIME NOT NULL,
  last_seen     DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  prompt_id     TEXT NOT NULL REFERENCES prompts(id),
  version       INTEGER NOT NULL,
  body          TEXT NOT NULL,
  body_hash     TEXT NOT NULL,
  created_at    DATETIME NOT NULL,
  PRIMARY KEY (prompt_id, version)
);
CREATE INDEX IF NOT EXISTS idx_pv_hash ON prompt_versions(body_hash);

CREATE TABLE IF NOT EXISTS subagent_invocations (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL REFERENCES sessions(id),
  parent_usage_id    TEXT REFERENCES prompt_usages(id),
  agent_type         TEXT NOT NULL,
  agent_id           TEXT NOT NULL,
  started_at         DATETIME NOT NULL,
  ended_at           DATETIME,
  transcript_path    TEXT,
  prompt_text        TEXT,
  prompt_hash        TEXT,
  response_text      TEXT,
  tool_use_count     INTEGER DEFAULT 0,
  status             TEXT
);
CREATE INDEX IF NOT EXISTS idx_sai_session ON subagent_invocations(session_id);

CREATE TABLE IF NOT EXISTS tool_use_rollups (
  session_id       TEXT NOT NULL REFERENCES sessions(id),
  tool_name        TEXT NOT NULL,
  call_count       INTEGER DEFAULT 0,
  fail_count       INTEGER DEFAULT 0,
  total_ms         INTEGER DEFAULT 0,
  total_in_bytes   INTEGER DEFAULT 0,
  total_out_bytes  INTEGER DEFAULT 0,
  PRIMARY KEY (session_id, tool_name)
);

CREATE TABLE IF NOT EXISTS rule_hits (
  usage_id   TEXT NOT NULL REFERENCES prompt_usages(id),
  rule_id    TEXT NOT NULL,
  severity   INTEGER NOT NULL,
  message    TEXT NOT NULL,
  evidence   TEXT,
  PRIMARY KEY (usage_id, rule_id)
);
CREATE INDEX IF NOT EXISTS idx_rh_rule ON rule_hits(rule_id);

CREATE TABLE IF NOT EXISTS quality_scores (
  usage_id      TEXT PRIMARY KEY REFERENCES prompt_usages(id),
  rule_score    INTEGER NOT NULL,
  usage_score   INTEGER,
  judge_score   INTEGER,
  final_score   INTEGER NOT NULL,
  tier          TEXT NOT NULL,
  computed_at   DATETIME NOT NULL,
  rules_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qs_final ON quality_scores(final_score);

CREATE TABLE IF NOT EXISTS rewrites (
  id              TEXT PRIMARY KEY,
  usage_id        TEXT NOT NULL REFERENCES prompt_usages(id),
  before_text     TEXT NOT NULL,
  after_text      TEXT NOT NULL,
  diff            TEXT,
  reason          TEXT,
  model           TEXT NOT NULL,
  status          TEXT NOT NULL,
  created_at      DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id         TEXT PRIMARY KEY,
  ts         DATETIME NOT NULL,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  detail     TEXT
);

INSERT OR IGNORE INTO _meta(key, value) VALUES
  ('schema_version', '1'),
  ('rules_version', '1');
`;

/**
 * v0.1.2 schema additions:
 *   - prompt_usages.detected_language (TEXT)
 *   - outcomes table for user feedback (Stage 5)
 */
export const MIGRATION_002: string = `
ALTER TABLE prompt_usages ADD COLUMN detected_language TEXT;

CREATE TABLE IF NOT EXISTS outcomes (
  id          TEXT PRIMARY KEY,
  usage_id    TEXT NOT NULL REFERENCES prompt_usages(id),
  rating      TEXT NOT NULL,               -- 'up' | 'down'
  note        TEXT,
  created_at  DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outcomes_usage ON outcomes(usage_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_rating ON outcomes(rating);
`;

/**
 * v0.3.0 schema additions — multi-source ingest (browser extension).
 *   - prompt_usages.browser_session_id   identifier assigned by the extension (URL-derived)
 *   - index on sessions.source (column existed since v1; index is new)
 *
 * `sessions.source` column already exists since MIGRATION_001 (originally
 * used for Claude Code "startup / resume / clear / compact" tags).
 * We now overload it for `'claude-code' | 'chatgpt' | 'claude-ai' | ...`
 * and let upsertSession default to 'claude-code' when unset.
 *
 * See docs/09-browser-extension-design.md §7.
 */
export const MIGRATION_003: string = `
ALTER TABLE prompt_usages ADD COLUMN browser_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source);
UPDATE sessions SET source = 'claude-code' WHERE source IS NULL;
`;

/**
 * v0.4.0 schema additions — deep LLM analysis (consent-gated).
 *
 * A deep analysis is richer than a simple rewrite: it exposes identified
 * problem categories, step-by-step reasoning, and the suggested rewrite in
 * a single structured row. Kept separate from `rewrites` so the shape can
 * evolve without breaking historical rows.
 *
 * See docs/00-decision-log.md D-033.
 */
export const MIGRATION_004: string = `
CREATE TABLE IF NOT EXISTS deep_analyses (
  id                TEXT PRIMARY KEY,
  usage_id          TEXT NOT NULL REFERENCES prompt_usages(id),
  model             TEXT NOT NULL,
  status            TEXT NOT NULL,            -- 'ok' | 'failed'
  problems_json     TEXT NOT NULL,            -- JSON: [{category, severity, explanation}]
  reasoning_json    TEXT NOT NULL,            -- JSON: string[]
  after_text        TEXT NOT NULL,
  applied_fixes     TEXT,                     -- JSON: string[] (rule ids)
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  error_message     TEXT,
  created_at        DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deep_usage ON deep_analyses(usage_id);
CREATE INDEX IF NOT EXISTS idx_deep_created ON deep_analyses(created_at DESC);
`;

/**
 * v0.4.0 schema change — remove the `rewrites` table.
 *
 * The `think-prompt rewrite` CLI command and its automatic worker job are
 * removed in v0.4.0 (see D-041). The `rewrites` table is dropped on existing
 * installs so the DB doesn't carry dead schema. Deep analysis (D-033) keeps
 * its own `deep_analyses` table untouched — it's a different feature with
 * its own consent gating.
 */
export const MIGRATION_005: string = `
DROP TABLE IF EXISTS rewrites;
`;

/**
 * v0.6.0 schema additions — D-046 asymmetric scoring + confidence + baseline.
 *
 * - quality_scores.efficiency_score (INT, nullable) — Phase 1 efficiency axis.
 * - quality_scores.bonus_score       (INT, nullable) — positive signal bonus applied (0..10).
 * - quality_scores.cap_applied       (INT, nullable) — if cap floor was triggered, the cap value.
 * - quality_scores.confidence        (TEXT, nullable) — 'high' | 'medium' | 'low'.
 * - quality_scores.baseline_delta    (INT, nullable) — final_score - user_baseline (Phase 3).
 * - user_baseline_snapshots          — rolling-window aggregate per user/scope.
 *
 * All columns are nullable so old rows keep working; new scorer always writes them.
 * See docs/00-decision-log.md D-046 and docs/05-quality-engine.md §3..§6.
 */
export const MIGRATION_006: string = `
ALTER TABLE quality_scores ADD COLUMN efficiency_score INTEGER;
ALTER TABLE quality_scores ADD COLUMN bonus_score      INTEGER;
ALTER TABLE quality_scores ADD COLUMN cap_applied      INTEGER;
ALTER TABLE quality_scores ADD COLUMN confidence       TEXT;
ALTER TABLE quality_scores ADD COLUMN baseline_delta   INTEGER;

CREATE TABLE IF NOT EXISTS user_baseline_snapshots (
  id                TEXT PRIMARY KEY,
  scope             TEXT NOT NULL,          -- 'global' for now; room for per-cwd later
  window_days       INTEGER NOT NULL,
  computed_at       DATETIME NOT NULL,
  sample_size       INTEGER NOT NULL,
  avg_final_score   REAL NOT NULL,
  avg_word_count    REAL NOT NULL,
  avg_severity_hits REAL NOT NULL,
  snapshot_json     TEXT                    -- reserved for future axes
);
CREATE INDEX IF NOT EXISTS idx_baseline_scope ON user_baseline_snapshots(scope, computed_at DESC);

-- prompt_usages gets per-turn efficiency features extracted by the worker.
-- Kept as a sibling to quality_scores so re-scoring doesn't lose input features.
ALTER TABLE prompt_usages ADD COLUMN first_shot_success INTEGER;  -- 0|1|null
ALTER TABLE prompt_usages ADD COLUMN tool_call_count    INTEGER;
ALTER TABLE prompt_usages ADD COLUMN follow_up_depth    INTEGER;
`;

-- Pro-Prompt schema v1. See docs/03-local-storage.md §2.
-- SQLite, WAL mode.

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

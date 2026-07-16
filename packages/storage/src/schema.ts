/**
 * Schema migrations for the append-only event log (spec §G.4, §K).
 *
 * Migrations are ordered and applied once, tracked in `schema_migrations`.
 * The `events` table is append-only; `id` is the monotonic append cursor used by
 * projections, distinct from the provider-supplied per-session `seq`.
 */

export interface Migration {
  version: number;
  up: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS events (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id          TEXT NOT NULL UNIQUE,
        dedupe_key        TEXT NOT NULL UNIQUE,
        dedupe_confidence TEXT NOT NULL,
        schema_version    INTEGER NOT NULL,
        kind              TEXT NOT NULL,
        provider          TEXT NOT NULL,
        source            TEXT NOT NULL,
        source_event_id   TEXT,
        workspace_id      TEXT NOT NULL,
        session_id        TEXT NOT NULL,
        run_id            TEXT,
        agent_id          TEXT,
        seq               INTEGER,
        occurred_at       INTEGER NOT NULL,
        received_at       INTEGER NOT NULL,
        confidence        TEXT NOT NULL,
        payload           TEXT NOT NULL,
        raw_ref           TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id, id);
      CREATE INDEX IF NOT EXISTS idx_events_workspace ON events (workspace_id, id);
    `,
  },
];

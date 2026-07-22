/**
 * Idempotent forward-only migration runner (spec §K.2). Applies every migration
 * whose version exceeds the highest applied version, inside a transaction each.
 */

import type { Database } from './db.js';
import { MIGRATIONS, type Migration } from './schema.js';

function currentVersion(db: Database): number {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row?.v ?? 0;
}

export function runMigrations(db: Database, migrations: readonly Migration[] = MIGRATIONS): void {
  const from = currentVersion(db);
  const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version <= from) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.up);
      // schema_migrations has no wall clock available here; a monotonic marker is
      // enough. Callers that need timestamps can add them at a higher layer.
      record.run(migration.version, migration.version);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

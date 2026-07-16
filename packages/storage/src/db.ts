/**
 * SQLite handle (spec §K.1). Uses Node's built-in `node:sqlite` (already used by
 * the Efficio reader in this repo) so there is no native build dependency.
 * File-backed databases run in WAL mode for concurrent read/write; `:memory:`
 * databases (tests) ignore the pragma harmlessly.
 */

import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

export function openDatabase(location: string): Database {
  const db = new DatabaseSync(location);
  db.exec('PRAGMA foreign_keys = ON');
  if (location !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  return db;
}

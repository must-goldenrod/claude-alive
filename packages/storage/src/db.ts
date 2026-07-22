/**
 * SQLite handle (spec §K.1). Uses better-sqlite3 — the same native driver the
 * Efficio prompt store already uses in this repo — so it runs on every Node
 * version the project supports (`engines: >=20`). Node's built-in `node:sqlite`
 * was avoided because it does not exist on Node 20 and is only unflagged from
 * Node 24, which breaks the CI matrix (Node 20/22).
 * File-backed databases run in WAL mode for concurrent read/write; `:memory:`
 * databases (tests) skip the pragma harmlessly.
 */

import BetterSqlite3, { type Database as Db } from 'better-sqlite3';

export type Database = Db;

export function openDatabase(location: string): Database {
  const db = new BetterSqlite3(location);
  db.exec('PRAGMA foreign_keys = ON');
  if (location !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  return db;
}

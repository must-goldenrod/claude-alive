/**
 * @claude-alive/storage — SQLite append-only event log and dedupe (spec §K).
 */

export { openDatabase } from './db.js';
export type { Database } from './db.js';
export { runMigrations } from './migrator.js';
export { MIGRATIONS } from './schema.js';
export type { Migration } from './schema.js';
export { computeDedupeKey } from './dedupe.js';
export type { DedupeKey } from './dedupe.js';
export { EventStore } from './eventStore.js';
export type { ReadResult, SessionReadResult } from './eventStore.js';
export { SessionRefStore } from './sessionRefs.js';
export type { ProviderRef } from './sessionRefs.js';
export { WorkspaceStore } from './workspaceStore.js';

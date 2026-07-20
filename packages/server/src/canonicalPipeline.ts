/**
 * Canonical (v2) ingest pipeline — the dual-write side of P1.
 *
 * The legacy path (`SessionStore` → WebSocket) stays exactly as it was. This
 * runs alongside it, converting each Claude hook into canonical events and
 * persisting them to the append-only log so that state survives a restart and a
 * provider-neutral projection can be built.
 *
 * Two properties are non-negotiable, because this sits on the hook path that the
 * whole product depends on:
 *
 *  1. **It can never break ingest.** Every failure — a database that will not
 *     open, a git probe that throws — disables or skips this side and is logged.
 *     The legacy path is unaffected (§C.7).
 *  2. **Order is preserved.** Work is serialized through one promise chain, so
 *     events land in the log in arrival order even though workspace probing is
 *     async. Out-of-order appends would corrupt projection replay (§K.2).
 */

import {
  ClaudeCanonicalStream,
  probeWorkspace,
  ulid,
  type CommandRunner,
  type HookEventPayload,
  type WorkspaceIdentity,
} from '@claude-alive/core';
import {
  EventStore,
  SessionRefStore,
  WorkspaceStore,
  openDatabase,
  runMigrations,
  type Database,
} from '@claude-alive/storage';

export interface CanonicalPipelineOptions {
  /** SQLite location; `:memory:` for tests. */
  dbPath?: string;
  /** Command runner for the workspace probe (injected for tests / SSH reuse). */
  runner?: CommandRunner;
  locationId?: string;
}

export interface CanonicalPipeline {
  readonly enabled: boolean;
  /** Queue a hook for canonical processing. Never rejects. */
  ingest(payload: HookEventPayload): Promise<void>;
  /** Await all queued work (tests, shutdown). */
  drain(): Promise<void>;
  stats(): { events: number; sessions: number; workspaces: number };
  close(): void;
}

const DISABLED: CanonicalPipeline = {
  enabled: false,
  async ingest() {},
  async drain() {},
  stats: () => ({ events: 0, sessions: 0, workspaces: 0 }),
  close() {},
};

export function createCanonicalPipeline(options: CanonicalPipelineOptions = {}): CanonicalPipeline {
  const dbPath = options.dbPath ?? ':memory:';
  const locationId = options.locationId ?? 'local';

  let db: Database;
  try {
    db = openDatabase(dbPath);
    runMigrations(db);
  } catch (error) {
    console.error(
      `[canonical] event log unavailable at ${dbPath}; v2 ingest disabled for this run. ` +
        'The dashboard is unaffected.',
      error,
    );
    return DISABLED;
  }

  const events = new EventStore(db);
  const refs = new SessionRefStore(db, ulid);
  const workspaceStore = new WorkspaceStore(db);
  const stream = new ClaudeCanonicalStream();
  /** In-process probe cache; identity itself is persisted in `workspaces`. */
  const workspaces = new Map<string, WorkspaceIdentity>();

  // Serializes async work so log order matches arrival order.
  let tail: Promise<void> = Promise.resolve();

  async function workspaceFor(cwd: string): Promise<WorkspaceIdentity | null> {
    const cached = workspaces.get(cwd);
    if (cached) return cached;
    if (!options.runner) return null;
    const probed = await probeWorkspace(
      { cwd, locationId, workspaceId: ulid() },
      options.runner,
    );
    // The probed ULID is only a candidate: if this (location, rootPath) is
    // already known, its stored id wins so a restart does not fork the workspace.
    const identity = workspaceStore.upsert(probed);
    // Key by the requested cwd so repeat hooks skip the probe, and by the
    // resolved root so sibling directories of one repo share the workspace.
    workspaces.set(cwd, identity);
    workspaces.set(identity.rootPath, identity);
    return identity;
  }

  async function process(payload: HookEventPayload): Promise<void> {
    const cwd = payload.data.cwd;
    if (!cwd) return; // Without a cwd there is no workspace to attribute it to.

    const workspace = await workspaceFor(cwd);
    if (!workspace) return;

    const sessionId = refs.resolve('claude', payload.session_id);
    const canonical = stream.push(payload, {
      sessionId,
      workspaceId: workspace.workspaceId,
      receivedAt: Date.now(),
      newEventId: ulid,
    });
    for (const event of canonical) events.append(event);
  }

  return {
    enabled: true,
    ingest(payload) {
      tail = tail.then(() => process(payload)).catch((error) => {
        // Isolated: a canonical-side failure must not surface on the hook path.
        console.error('[canonical] failed to ingest a hook; v2 log may have a gap:', error);
      });
      return Promise.resolve();
    },
    drain: () => tail,
    stats: () => ({
      events: events.count(),
      sessions: refs.count(),
      workspaces: workspaceStore.count(),
    }),
    close() {
      try {
        db.close();
      } catch {
        // Already closed or never opened cleanly; nothing to recover.
      }
    },
  };
}

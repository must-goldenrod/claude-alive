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
  applyCanonicalEvent,
  buildConversation,
  buildProjection,
  emptyProjection,
  pickTitleSource,
  probeWorkspace,
  ulid,
  type CommandRunner,
  type HookEventPayload,
  type CanonicalEvent,
  type ConversationItem,
  type LocationSummary,
  type ProjectionState,
  type SessionProjectionRow,
  type TitleSource,
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

/** One session as the tree exposes it (§I.5 `SessionSummary`). */
export interface SessionSummary {
  sessionId: string;
  provider: string;
  providerSessionId?: string;
  title: string;
  titleSource: TitleSource;
  firstPromptPreview?: string;
  state: SessionProjectionRow['state'];
  stateConfidence: SessionProjectionRow['stateConfidence'];
  currentTool?: string;
  pendingApprovals: number;
  lastActiveAt: number;
}

export interface WorkspaceTreeProjection {
  locations: Array<{
    location: LocationSummary;
    workspaces: Array<{ workspace: WorkspaceIdentity; sessions: SessionSummary[] }>;
  }>;
}

export interface ConversationPage {
  sessionId: string;
  items: ConversationItem[];
  cursor: number;
  hasMore: boolean;
  /**
   * Claude hooks carry one assistant message per turn, not the streamed reply,
   * so a hook-derived conversation is partial by construction. Surfaced rather
   * than implied, so the UI never presents it as the whole transcript (§F.7).
   */
  completeness: 'hook-derived';
}

/** A persisted managed session as the legacy store holds it. */
export interface LegacyManagedRecord {
  tabId: string;
  claudeSessionId: string;
  cwd?: string;
  displayName?: string;
  mode: 'claude' | 'shell';
  claudeVariant?: 'claude' | 'agents';
  createdAt: number;
  lastActive: number;
}

export interface LegacyImportResult {
  imported: number;
  skipped: Array<{ id: string; reason: string }>;
}

export interface CanonicalPipeline {
  readonly enabled: boolean;
  /** Queue a hook for canonical processing. Never rejects. */
  ingest(payload: HookEventPayload): Promise<void>;
  /** Await all queued work (tests, shutdown). */
  drain(): Promise<void>;
  /** Server-owned catalog: Location → Workspace → Session (§I.5). */
  tree(): WorkspaceTreeProjection;
  /** One session's dialogue, paginated (§F.7, §J.1). */
  conversation(sessionId: string, cursor?: number, limit?: number): ConversationPage | null;
  /** One-time import of pre-canonical sessions; idempotent (§P0 migration). */
  importLegacySessions(records: readonly LegacyManagedRecord[]): Promise<LegacyImportResult>;
  stats(): { events: number; sessions: number; workspaces: number };
  close(): void;
}

const DISABLED: CanonicalPipeline = {
  enabled: false,
  async ingest() {},
  async drain() {},
  tree: () => ({ locations: [] }),
  conversation: () => null,
  async importLegacySessions() {
    return { imported: 0, skipped: [] };
  },
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

  // Read model kept in step with the log. Rebuilt from the log on boot, so a
  // restart reconstructs exactly the state the events describe (§K.2).
  let projection: ProjectionState = emptyProjection();
  try {
    projection = buildProjection(events.readAfter(0, 100_000).events);
  } catch (error) {
    console.error('[canonical] could not rebuild the projection from the log:', error);
  }

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
    for (const event of canonical) {
      const { inserted } = events.append(event);
      // Only advance the read model for events that were actually stored;
      // a deduped redelivery must not be counted twice.
      if (inserted) projection = applyCanonicalEvent(projection, event);
    }
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
    tree() {
      const location: LocationSummary = {
        locationId,
        kind: 'local',
        displayName: 'This Mac',
        status: 'online',
      };

      const byWorkspace = new Map<string, SessionSummary[]>();
      for (const row of Object.values(projection.sessions)) {
        const ref = refs.findProviderRef(row.sessionId);
        const title = pickTitleSource({
          manual: row.displayName,
          firstPrompt: row.firstPrompt,
          now: row.lastEventAt,
        });
        const summary: SessionSummary = {
          sessionId: row.sessionId,
          provider: row.provider,
          providerSessionId: ref?.providerSessionId,
          title: title.title,
          titleSource: title.titleSource,
          firstPromptPreview: title.firstPromptPreview,
          state: row.state,
          stateConfidence: row.stateConfidence,
          currentTool: row.currentTool,
          pendingApprovals: row.pendingApprovals,
          lastActiveAt: row.lastEventAt,
        };
        const list = byWorkspace.get(row.workspaceId) ?? [];
        list.push(summary);
        byWorkspace.set(row.workspaceId, list);
      }

      const workspaces = [...byWorkspace.entries()]
        .map(([workspaceId, sessions]) => {
          const workspace = workspaceStore.findById(workspaceId);
          if (!workspace) return null;
          // Most recently active first — the order the tree is read in.
          sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
          return { workspace, sessions };
        })
        .filter((w): w is { workspace: WorkspaceIdentity; sessions: SessionSummary[] } => w !== null)
        .sort((a, b) => a.workspace.displayName.localeCompare(b.workspace.displayName));

      return { locations: [{ location, workspaces }] };
    },
    async importLegacySessions(records) {
      const skipped: LegacyImportResult['skipped'] = [];
      let imported = 0;

      for (const record of records) {
        if (record.mode !== 'claude') {
          skipped.push({ id: record.claudeSessionId, reason: 'terminal-only (non-claude mode)' });
          continue;
        }
        if (!record.cwd) {
          skipped.push({ id: record.claudeSessionId, reason: 'no cwd — cannot place under a workspace' });
          continue;
        }

        try {
          const workspace = await workspaceFor(record.cwd);
          if (!workspace) {
            skipped.push({ id: record.claudeSessionId, reason: 'workspace probe unavailable' });
            continue;
          }
          const sessionId = refs.resolve('claude', record.claudeSessionId);

          // Synthetic origin event. The projection is built from the log, so a
          // migrated session needs an event to exist at all. The stable
          // sourceEventId makes re-running the import a no-op via dedupe rather
          // than needing a separate "already migrated" flag.
          const event: CanonicalEvent = {
            schemaVersion: 2,
            eventId: ulid(),
            kind: 'session.created',
            provider: 'claude',
            source: 'synthetic',
            sourceEventId: `migration:v1:${record.claudeSessionId}`,
            workspaceId: workspace.workspaceId,
            sessionId,
            occurredAt: record.createdAt,
            receivedAt: record.lastActive,
            // Reconstructed from a registry, not observed live.
            confidence: 'derived',
            payload: {
              cwd: record.cwd,
              displayName: record.displayName,
              source: 'legacy-managed-session',
            },
          };
          const { inserted } = events.append(event);
          if (inserted) {
            projection = applyCanonicalEvent(projection, event);
            imported += 1;
          }
        } catch (error) {
          skipped.push({
            id: record.claudeSessionId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return { imported, skipped };
    },
    conversation(sessionId, cursor = 0, limit = 500) {
      // Unknown session → null, so the caller can answer 404 rather than
      // implying an empty-but-valid conversation.
      if (!refs.findProviderRef(sessionId)) return null;
      const page = events.readSession(sessionId, cursor, limit);
      return {
        sessionId,
        items: buildConversation(page.events),
        cursor: page.cursor,
        hasMore: page.hasMore,
        completeness: 'hook-derived',
      };
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

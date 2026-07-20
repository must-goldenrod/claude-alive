/**
 * Legacy → canonical state migration (spec §P0).
 *
 * Today a session's identity is smeared across four stores: live agents in the
 * in-memory SessionStore, UI-spawned sessions in `~/.claude-alive/managed-sessions.json`,
 * open tabs in browser localStorage, and project names derived from cwd. This
 * module folds them into one `Location → Workspace → Session` shape.
 *
 * The P0 exit gate is the invariant driving the design: a session must appear
 * **exactly once** under its Location/Workspace. Sources are therefore merged on
 * the provider session id, with precedence live agent > managed session > tab —
 * the live agent knows the current state, the managed record knows the resume id.
 *
 * Entries that cannot become sessions (a plain shell tab, a subagent, a record
 * with no cwd) are returned in `skipped` with a reason rather than dropped, so a
 * migration never loses rows invisibly (§C.10).
 *
 * Scope: local only. SSH sessions live in React state and are never written to
 * the managed-session store, so none of the legacy inputs can express a remote
 * location. Migrating SSH presets into `Location` records is P3.5 — until then
 * callers must not feed remote sessions here, since they would be folded into
 * the local location and could collide with a local session on the same path.
 */

import type { LocationSummary, WorkspaceIdentity } from './workspace.js';
import type { HistoryCapability, ResumeCapability, SessionLifecycle, SessionRecord } from './domain.js';
import { pickTitleSource } from './title.js';

export interface LegacyAgent {
  /**
   * For a root agent this is the Claude session id. For a subagent it is the
   * synthetic `agent_id` minted by SubagentStart, and `parentId` holds the real
   * parent session — such entries are agents *within* a session, not sessions.
   */
  sessionId: string;
  parentId?: string | null;
  cwd: string;
  state: string;
  displayName?: string | null;
  lastPrompt?: string | null;
  /** Presence is the evidence that a structured transcript exists. */
  transcriptPath?: string | null;
  createdAt: number;
  lastEventTime: number;
  source?: 'spawned-by-ui' | 'external';
}

export interface LegacyManagedSession {
  tabId: string;
  claudeSessionId: string;
  cwd?: string;
  displayName?: string;
  mode: 'claude' | 'shell';
  claudeVariant?: 'claude' | 'agents';
  createdAt: number;
  lastActive: number;
}

export interface LegacyOpenTab {
  tabId: string;
  claudeSessionId?: string;
  cwd?: string;
  label: string;
  mode: 'claude' | 'shell';
  claudeVariant?: 'claude' | 'agents';
  displayName?: string;
}

export interface MigrationInput {
  agents?: LegacyAgent[];
  managedSessions?: LegacyManagedSession[];
  openTabs?: LegacyOpenTab[];
  localLocationId: string;
  localLocationName?: string;
  now: number;
  newId: () => string;
}

export interface SkippedEntry {
  source: 'agent' | 'managed-session' | 'open-tab';
  id: string;
  reason: string;
}

export interface MigrationResult {
  locations: LocationSummary[];
  workspaces: WorkspaceIdentity[];
  sessions: SessionRecord[];
  skipped: SkippedEntry[];
}

/** Cross-platform basename; core also runs in the browser, so no node:path. */
function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/**
 * Canonicalize a root path for use as a workspace key (§F.5). Trims, collapses
 * duplicate separators, and drops a trailing separator so `/repo/alpha`,
 * `/repo/alpha/`, and `/repo//alpha` are one workspace.
 *
 * Deliberately does NOT case-fold: case sensitivity is filesystem-dependent, and
 * folding would merge genuinely distinct directories on Linux. Resolving
 * symlinks and case-insensitive collisions needs filesystem access, so it stays
 * with the runtime workspace probe (P1) rather than this pure migration.
 */
function canonicalizeRootPath(path: string): string {
  const trimmed = path.trim().replace(/\/{2,}/g, '/');
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed;
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/** Live-ish Claude agent states, per the existing AgentState vocabulary. */
const LIVE_STATES = new Set(['spawning', 'idle', 'listening', 'active', 'waiting']);

/**
 * Map a legacy agent state to a canonical lifecycle.
 *
 * `SessionLifecycle` is a single mutually-exclusive enum in which `external`
 * sits alongside `completed`/`failed`, so a finished externally-started session
 * reports the terminal fact and its "we did not spawn this" provenance survives
 * only as `resumeCapability: 'unknown'` (no managed record). Carrying both would
 * need a provenance field on SessionRecord, which is a contract change beyond
 * this migration.
 */
function lifecycleFor(agent: LegacyAgent | undefined): SessionLifecycle {
  if (!agent) return 'dormant';
  if (agent.state === 'done') return 'completed';
  if (agent.state === 'error') return 'failed';
  if (LIVE_STATES.has(agent.state)) return agent.source === 'external' ? 'external' : 'live';
  // despawning / removed: the process is gone but the conversation may resume.
  return 'dormant';
}

interface Candidate {
  providerSessionId: string;
  cwd?: string;
  displayName?: string;
  lastPrompt?: string;
  transcriptPath?: string;
  createdAt?: number;
  lastActiveAt?: number;
  agent?: LegacyAgent;
  hasManagedRecord: boolean;
  /** Highest-precedence source that contributed, for accurate skip reporting. */
  source: SkippedEntry['source'];
}

export function migrateLegacyState(input: MigrationInput): MigrationResult {
  const { localLocationId, localLocationName, now, newId } = input;
  const skipped: SkippedEntry[] = [];
  const candidates = new Map<string, Candidate>();

  /**
   * Merge a source into the candidate. Sources are applied in precedence order
   * (agent → managed → tab), so an already-present value is the higher-precedence
   * one and must NOT be overwritten: `prev ?? patch`, never `patch ?? prev`.
   * This matters because `renameAgent` updates only the live agent, leaving the
   * managed record's displayName stale.
   */
  const upsert = (id: string, patch: Partial<Candidate> & { source: SkippedEntry['source'] }) => {
    const prev = candidates.get(id);
    candidates.set(id, {
      providerSessionId: id,
      cwd: prev?.cwd ?? patch.cwd,
      displayName: prev?.displayName ?? patch.displayName,
      lastPrompt: prev?.lastPrompt ?? patch.lastPrompt,
      transcriptPath: prev?.transcriptPath ?? patch.transcriptPath,
      agent: prev?.agent ?? patch.agent,
      hasManagedRecord: (prev?.hasManagedRecord ?? false) || (patch.hasManagedRecord ?? false),
      source: prev?.source ?? patch.source,
      // Timestamps take the widest known range; tabs contribute none.
      createdAt: minDefined(prev?.createdAt, patch.createdAt),
      lastActiveAt: maxDefined(prev?.lastActiveAt, patch.lastActiveAt),
    });
  };

  // Precedence: agents first (authoritative for current state), then managed
  // records (authoritative for the resume id), then tabs (weakest).
  for (const a of input.agents ?? []) {
    // A subagent is an agent inside a session, not a session of its own —
    // promoting it would place one conversation in the tree more than once.
    if (a.parentId) {
      skipped.push({ source: 'agent', id: a.sessionId, reason: `subagent of ${a.parentId} — not a top-level session` });
      continue;
    }
    upsert(a.sessionId, {
      source: 'agent',
      cwd: a.cwd,
      displayName: a.displayName ?? undefined,
      lastPrompt: a.lastPrompt ?? undefined,
      transcriptPath: a.transcriptPath ?? undefined,
      agent: a,
      hasManagedRecord: false,
      createdAt: a.createdAt,
      lastActiveAt: a.lastEventTime,
    });
  }

  for (const m of input.managedSessions ?? []) {
    if (m.mode !== 'claude') {
      skipped.push({ source: 'managed-session', id: m.claudeSessionId, reason: 'terminal-only (non-claude mode)' });
      continue;
    }
    upsert(m.claudeSessionId, {
      source: 'managed-session',
      cwd: m.cwd,
      displayName: m.displayName,
      hasManagedRecord: true,
      createdAt: m.createdAt,
      lastActiveAt: m.lastActive,
    });
  }

  for (const t of input.openTabs ?? []) {
    if (!t.claudeSessionId || t.mode !== 'claude') {
      skipped.push({ source: 'open-tab', id: t.tabId, reason: 'terminal-only: no agent session attached' });
      continue;
    }
    // A tab carries no timestamps; fabricating `now` here would make an old
    // session look brand new, so it contributes none.
    upsert(t.claudeSessionId, {
      source: 'open-tab',
      cwd: t.cwd,
      displayName: t.displayName,
      hasManagedRecord: false,
    });
  }

  // Workspaces are keyed by (locationId, rootPath) — a path alone is ambiguous
  // once SSH locations share path strings (§F.5).
  const workspaceByPath = new Map<string, WorkspaceIdentity>();
  const sessions: SessionRecord[] = [];

  for (const c of candidates.values()) {
    if (!c.cwd) {
      skipped.push({
        source: c.source,
        id: c.providerSessionId,
        reason: 'no cwd recorded — cannot place the session under a workspace',
      });
      continue;
    }

    const rootPath = canonicalizeRootPath(c.cwd);
    let workspace = workspaceByPath.get(rootPath);
    if (!workspace) {
      workspace = {
        workspaceId: newId(),
        locationId: localLocationId,
        rootPath,
        // Git detection is a runtime probe (P1); migration only knows the path.
        kind: 'folder',
        displayName: basename(rootPath),
      };
      workspaceByPath.set(rootPath, workspace);
    }

    const title = pickTitleSource({
      manual: c.displayName,
      firstPrompt: c.lastPrompt,
      now,
    });

    const resumeCapability: ResumeCapability = c.hasManagedRecord ? 'available' : 'unknown';
    // Evidence-based, not assumed (§D.3): a transcript path proves a transcript,
    // and a UI-spawned session is one we know Claude wrote one for. A session we
    // only ever saw as a browser tab proves nothing beyond terminal scrollback.
    const historyCapability: HistoryCapability =
      c.transcriptPath || c.hasManagedRecord ? 'transcript' : 'scrollback-only';

    sessions.push({
      sessionId: newId(),
      provider: 'claude',
      providerSessionId: c.providerSessionId,
      locationId: localLocationId,
      workspaceId: workspace.workspaceId,
      title: title.title,
      titleSource: title.titleSource,
      firstPromptPreview: title.firstPromptPreview,
      lifecycle: lifecycleFor(c.agent),
      historyCapability,
      resumeCapability,
      createdAt: c.createdAt ?? now,
      lastActiveAt: c.lastActiveAt ?? now,
    });
  }

  const locations: LocationSummary[] = [
    {
      locationId: localLocationId,
      kind: 'local',
      displayName: localLocationName ?? 'This Mac',
      status: 'online',
    },
  ];

  return { locations, workspaces: [...workspaceByPath.values()], sessions, skipped };
}

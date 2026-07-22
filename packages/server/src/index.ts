import { SessionStore, parseTranscriptTokens } from '@claude-alive/core';
import type { HookEventPayload } from '@claude-alive/core';
import { createPromptSubsystem, type PromptSubsystem } from '@think-prompt/agent';
import { createHttpServer } from './httpRouter.js';
import { WSBroadcaster } from './wsServer.js';
import { TerminalManager } from './terminalManager.js';
import {
  loadManagedSessions,
  saveManagedSession,
  touchManagedSession,
  removeManagedSession,
  getManagedSession,
  getManagedSessionIds,
  getManagedSessions,
  toResumableSessions,
} from './managedSessionStore.js';
import { buildSpawnPlaceholderEvent } from './spawnPlaceholder.js';
import { loadNames, getNames, saveName, removeName } from './nameStore.js';
import {
  loadProjectNames,
  getProjectName,
  getProjectNames,
  saveProjectName,
  removeProjectName,
} from './projectNameStore.js';
import {
  loadCompletedSessions,
  appendCompletedSession,
  updateArchivedTokenUsage,
  getCompletedArchive,
} from './completedStore.js';
import { SystemMetricsPoller } from './systemMetrics.js';
import { startWorkerLoop } from './promptWorker.js';
import { createCanonicalPipeline } from './canonicalPipeline.js';
import { resolveSessionTerminal } from './sessionTerminalLink.js';
import { readTranscriptConversation } from './transcriptLocator.js';
import { augmentPath } from './envPath.js';
import { createEfficioReader } from './efficioReader.js';
import { createEfficioCollector, resolveEfficioRoot } from './efficioCollector.js';
import { createTicketStore } from './ticketStore.js';
import { createTicketRunner } from './ticketRunner.js';
import { createVerifier } from './ticketVerifier.js';
import { resolveExecutor } from './executors/resolve.js';
import { sshListDirs } from './executors/sshBrowse.js';
import { createLitellmClient } from './orchestrator/litellmClient.js';
import { createBackendRegistry } from './orchestrator/backends.js';
import { ensureDelegateCli } from './orchestrator/delegateCli.js';
import { readDelegations } from './orchestrator/delegationStore.js';
import { createEvalStore } from './evalStore.js';
import { buildMainPrompt, buildOrchestratorPrompt } from './ticketPrompt.js';
import { watch, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const PORT = parseInt(process.env.CLAUDE_ALIVE_PORT ?? '3141', 10);

const store = new SessionStore();

/**
 * Tracks every Claude session UUID we (the server) spawned via `terminal:spawn`,
 * plus any restored from the persisted registry on boot. When a hook fires for a
 * sessionId, we cross-reference this set to mark the agent as 'spawned-by-ui' vs
 * 'external'. Resumed sessions also count as spawned-by-ui because the user
 * explicitly opted in via our UI.
 */
const managedSessionIds = new Set<string>();

// Load persisted names before starting the server. Project names (cwd-keyed) are the
// primary source of truth; the old sessionId-keyed nameStore is kept as a secondary
// fallback for agents whose cwd isn't in projectNames yet.
await loadNames();
await loadProjectNames();
// Load the registry of UI-spawned Claude sessions persisted across restarts. Every
// pty died when the previous process exited, so these start life as "dormant"
// (resumable) sessions. We also repopulate managedSessionIds so hooks that fire
// for a resumed session are still tagged 'spawned-by-ui'.
await loadManagedSessions();
for (const id of getManagedSessionIds()) managedSessionIds.add(id);
// Load the durable archive of completed sessions so the Archive view has history
// from the moment the server comes up (the in-memory store starts empty).
await loadCompletedSessions();

// Absorbed think-prompt subsystem. Owns its own SQLite handle and a
// Fastify instance mounted onto our shared http.Server below; no second
// port, no separate daemon. `ingest` is called from onEvent() to fan the
// same hook payload into the prompt-quality pipeline.
// Optional by design: this subsystem owns a native SQLite binding, and a Node
// upgrade leaves that binding unloadable (NODE_MODULE_VERSION mismatch). A
// failure here must not take the dashboard down with it — prompt analytics
// degrade to unavailable and agents/terminals/WebSocket keep working (§C.7).
// The failure is logged loudly rather than swallowed.
let promptSubsystem: PromptSubsystem | null = null;
try {
  promptSubsystem = createPromptSubsystem();
  await promptSubsystem.fastify.ready();
} catch (error) {
  promptSubsystem = null;
  console.error(
    '[prompt] subsystem failed to start — prompt analytics are disabled for this run. ' +
      'If this is a native module error, run `pnpm rebuild better-sqlite3`.',
    error,
  );
}

const despawnTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Read-only bridge to efficio's SQLite store (~/.efficio/efficio.db). The
// server never computes statistics — efficio (Python) writes pre-scored rows;
// we only read them. Absent/empty DB degrades gracefully to available:false.
const efficio = createEfficioReader();

// Canonical (v2) dual-write. Runs beside the legacy SessionStore path, never in
// front of it: if this cannot start, hooks keep flowing exactly as before
// (ADR-0003 storage location; §C.7 graceful degradation).
const ALIVE_DIR = join(homedir(), '.claude-alive');
try {
  mkdirSync(ALIVE_DIR, { recursive: true });
} catch {
  // Directory creation failure surfaces below when the database fails to open.
}
const execFileAsync = promisify(execFile);
/**
 * Coalesce catalog change signals: a busy session emits several events per
 * second, and the client only needs to know "refetch", not how many times.
 */
let catalogChangeTimer: ReturnType<typeof setTimeout> | null = null;
function signalCatalogChanged(): void {
  if (catalogChangeTimer) return;
  catalogChangeTimer = setTimeout(() => {
    catalogChangeTimer = null;
    broadcaster.broadcast({ type: 'v2:catalog-changed' });
  }, 300);
}

const canonicalPipeline = createCanonicalPipeline({
  dbPath: process.env.CLAUDE_ALIVE_EVENT_DB ?? join(ALIVE_DIR, 'alive.db'),
  locationId: 'local',
  onChange: signalCatalogChanged,
  // Full conversation from the Claude JSONL transcript when one exists (§F.7).
  readTranscript: (providerSessionId) => readTranscriptConversation(providerSessionId),
  // Read-only git probe for workspace identity; augmentPath so a reduced
  // launchd PATH does not make every workspace look like a plain folder.
  runner: async (command, args) => {
    try {
      const { stdout } = await execFileAsync(command, args, {
        timeout: 5_000,
        env: { ...process.env, PATH: augmentPath(process.env.PATH) },
      });
      return { ok: true, stdout };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return { ok: false, stdout: '', error: err?.message ?? String(error), code: err?.code };
    }
  },
});

// One-time import of pre-canonical sessions so an existing install sees its
// history in the new tree rather than an empty catalog. Idempotent: each record
// carries a stable synthetic sourceEventId, so re-running is a dedupe no-op.
// Fire-and-forget — a slow git probe must not delay the server listening.
if (canonicalPipeline.enabled) {
  void canonicalPipeline
    .importLegacySessions(getManagedSessions())
    .then((result) => {
      if (result.imported > 0) {
        console.log(`[canonical] imported ${result.imported} legacy session(s) into the catalog`);
      }
      if (result.skipped.length > 0) {
        // Never drop rows silently; an operator can see exactly what was left out.
        console.warn(`[canonical] skipped ${result.skipped.length} legacy session(s):`, result.skipped);
      }
    })
    .catch((error) => console.error('[canonical] legacy import failed:', error));
}

// Auto-collect: when a session ends, trigger `efficio collect` (debounced). The
// existing ~/.efficio watcher then broadcasts efficio:update so the UI refreshes.
// Disabled if efficio source isn't found or CLAUDE_ALIVE_AUTO_COLLECT=0.
const efficioCollector = createEfficioCollector({
  efficioRoot: process.env.CLAUDE_ALIVE_AUTO_COLLECT === '0' ? null : resolveEfficioRoot(),
  python: process.env.EFFICIO_PYTHON ?? 'python3',
  debounceMs: 60_000,
  onLog: (m) => console.log(m),
});

/** Persisted managed sessions that have no live pty right now — the resumable set. */
function getResumableSessions() {
  return toResumableSessions().filter((s) => !terminalManager.isLive(s.tabId));
}

function getSnapshot() {
  return {
    agents: store.getAllAgents(),
    recentEvents: store.getRecentEvents(100),
    completedSessions: store.getCompletedSessions(),
    stats: store.getStats(),
    resumableSessions: getResumableSessions(),
  };
}

/** Push the current resumable set to every connected client. */
function broadcastResumable(): void {
  broadcaster.broadcast({ type: 'sessions:resumable', sessions: getResumableSessions() });
}

function onEvent(payload: HookEventPayload): void {
  // Fan the same hook payload into the prompt-quality pipeline. Errors
  // there are isolated inside `ingest` (fail-open) so the UI broadcast
  // path below is never blocked.
  promptSubsystem?.ingest(payload);
  // v2 dual-write: queued and error-isolated, never blocks the legacy path below.
  void canonicalPipeline.ingest(payload);

  const agent = store.processEvent(payload);
  if (!agent) return;

  const event = payload.event;

  if (event === 'SessionStart' || event === 'SubagentStart') {
    // Resolve displayName in priority order: projectName (cwd) → legacy sessionId name.
    const projectName = agent.cwd ? getProjectName(agent.cwd) : undefined;
    const legacyName = getNames()[agent.sessionId];
    const resolved = projectName ?? legacyName;
    if (resolved) {
      store.renameAgent(agent.sessionId, resolved);
    }
    // Mark provenance: subagents inherit their parent's source; root agents are
    // 'spawned-by-ui' if we minted the sessionId via terminal:spawn, else 'external'.
    if (agent.parentId) {
      const parent = store.getAgent(agent.parentId);
      agent.source = parent?.source ?? 'external';
    } else {
      agent.source = managedSessionIds.has(agent.sessionId) ? 'spawned-by-ui' : 'external';
    }
    broadcaster.broadcast({ type: 'agent:spawn', agent });
  } else if (event === 'SessionEnd' || event === 'SubagentStop') {
    // Every terminated session is now archived by the store, so a completed
    // record always exists. Take the most recent match (findLast) in case a
    // sessionId was ever reused across the process lifetime.
    const completedSessions = store.getCompletedSessions();
    let completed: (typeof completedSessions)[number] | undefined;
    for (let i = completedSessions.length - 1; i >= 0; i--) {
      if (completedSessions[i]!.sessionId === agent.sessionId) {
        completed = completedSessions[i];
        break;
      }
    }
    if (completed) {
      // Persist to the durable archive (best-effort; never blocks the broadcast).
      appendCompletedSession(completed).catch((err) =>
        console.error(`[archive] failed to persist ${agent.sessionId}:`, err),
      );
      broadcaster.broadcast({ type: 'agent:completed', session: completed });
      // Delay despawn by 30s so the finished state is visible in the UI before
      // the agent card disappears.
      despawnTimers.set(agent.sessionId, setTimeout(() => {
        despawnTimers.delete(agent.sessionId);
        store.removeAgent(agent.sessionId);
        broadcaster.broadcast({ type: 'agent:despawn', sessionId: agent.sessionId });
      }, 30_000));
    } else {
      broadcaster.broadcast({ type: 'agent:despawn', sessionId: agent.sessionId });
    }

    // Session ended → transcript is complete. Trigger a debounced efficio collect
    // so the dashboard's efficiency scores stay current without manual CLI runs.
    efficioCollector.schedule();

    // Async transcript parsing (non-blocking). Token usage isn't known until the
    // transcript is parsed, which happens AFTER the archive snapshot was taken —
    // so backfill it into both the live store and the durable archive when ready.
    if (agent.transcriptPath) {
      parseTranscriptTokens(agent.transcriptPath).then((usage) => {
        if (usage) {
          const current = store.getAgent(agent.sessionId);
          if (current) {
            current.tokenUsage = usage;
          }
          store.setCompletedTokenUsage(agent.sessionId, usage);
          updateArchivedTokenUsage(agent.sessionId, usage).catch(() => {});
        }
      }).catch(() => {});
    }
  } else if (event === 'UserPromptSubmit' && payload.data.prompt) {
    broadcaster.broadcast({ type: 'agent:prompt', sessionId: agent.sessionId, prompt: payload.data.prompt });
    broadcaster.broadcast({
      type: 'agent:state',
      sessionId: agent.sessionId,
      state: agent.state,
      tool: agent.currentTool,
      animation: agent.currentToolAnimation,
      timestamp: payload.timestamp,
    });
  } else {
    broadcaster.broadcast({
      type: 'agent:state',
      sessionId: agent.sessionId,
      state: agent.state,
      tool: agent.currentTool,
      animation: agent.currentToolAnimation,
      timestamp: payload.timestamp,
    });
  }

  const recentEvents = store.getRecentEvents(1);
  if (recentEvents.length > 0) {
    broadcaster.broadcast({ type: 'event:new', entry: recentEvents[recentEvents.length - 1]! });
  }

  broadcaster.broadcast({ type: 'stats:update', stats: store.getStats() });
}

function renameAgent(sessionId: string, name: string | null): boolean {
  const ok = store.renameAgent(sessionId, name);
  if (ok) {
    broadcaster.broadcast({ type: 'agent:rename', sessionId, name });
    if (name !== null) {
      saveName(sessionId, name).catch(() => {});
    } else {
      removeName(sessionId).catch(() => {});
    }
  }
  return ok;
}

function removeAgent(sessionId: string): boolean {
  const ok = store.removeAgent(sessionId);
  if (ok) {
    broadcaster.broadcast({ type: 'agent:despawn', sessionId });
  }
  return ok;
}

// ── Ticket dashboard (spec 2026-07-21) ───────────────────────────────────────
// Autonomous headless agents driven by cards. `broadcast` forward-references
// `broadcaster` (assigned below); it's only invoked at runtime, long after both
// are initialised — same pattern as TerminalManager's `send`.
const ticketStore = createTicketStore();
await ticketStore.load();
const evalStore = createEvalStore();
await evalStore.load();
// Write the `ca-delegate` sub-agent tool and capture its absolute path, embedded
// in the orchestrator prompt so an orchestrated ticket can delegate to litellm.
// Its dir is prepended to the agent PATH (main + verifier) so `command -v
// ca-delegate` resolves — the verifier must know the delegation tool is real.
const delegateCmd = ensureDelegateCli();
const delegateBinDir = dirname(delegateCmd);

// Local cwd allowlist (colon-separated). Applies to LOCAL tickets only; remote
// (ssh) tickets are gated by the loopback-only create route + host ownership.
const localAllowedRoots = process.env.CLAUDE_ALIVE_TICKET_ROOTS?.split(':').filter(Boolean);
// Resolve the execution backend for a ticket's location: local child process, or
// SSH to a remote host. Absent location = local.
const executorFor = (location: import('@claude-alive/core').TicketLocation | undefined) =>
  resolveExecutor(location, { localAllowedRoots });

// The verifier runs at the SAME location as the main agent.
const ticketVerifier = createVerifier({
  run: ({ goal, cwd, location, orchestrated }) =>
    executorFor(location).spawn({
      goal,
      cwd,
      permissionMode: 'bypassPermissions',
      ...(orchestrated ? { pathPrepend: delegateBinDir } : {}),
    }).done,
});
const ticketRunner = createTicketRunner({
  store: ticketStore,
  // Explicit privileged mode from server config (never from the HTTP body).
  // Prepend the route's learned guide (from past good/bad evaluations) and append
  // the one-line headline instruction (parsed by extractHeadline). The guide is
  // read at spawn time, so newer labels take effect on the next ticket.
  spawnMain: (ticket, opts) => {
    // Orchestrated tickets run with the orchestrator prompt + delegation tool.
    // Only for local execution (the ca-delegate CLI lives on the server host, so
    // an SSH-run agent couldn't call it — remote orchestration is a follow-up).
    const orchestrated = Boolean(ticket.orchestrated) && ticket.location?.kind !== 'ssh';
    const goal = opts?.prompt
      ? // Follow-up reply: wrap the raw answer and resume the same session.
        buildMainPrompt(opts.prompt)
      : orchestrated
        ? buildOrchestratorPrompt(ticket.goal, evalStore.guideFor(ticket.cwd).text, delegateCmd)
        : buildMainPrompt(ticket.goal, evalStore.guideFor(ticket.cwd).text);
    return executorFor(ticket.location).spawn({
      goal,
      cwd: ticket.cwd,
      permissionMode: 'bypassPermissions',
      resumeSessionId: opts?.resumeSessionId,
      // Only the orchestrator run gets the delegate tool + a ticket tag; the
      // verifier deliberately omits CA_TICKET_ID so its re-delegations aren't logged.
      ...(orchestrated ? { pathPrepend: delegateBinDir, extraEnv: { CA_TICKET_ID: ticket.id } } : {}),
    });
  },
  verify: (ticket, mainResult) => ticketVerifier.verify(ticket, mainResult),
  // Location-aware cwd validation (local fs, or remote `ssh test -d`).
  validateCwd: (ticket) => executorFor(ticket.location).validateCwd(ticket.cwd),
  broadcast: (ticket) => broadcaster.broadcast({ type: 'ticket:update', ticket }),
  // Record an evaluation whenever a ticket settles; broadcast it so clients update.
  onSettled: async (ticket) => {
    // Attach the orchestrator's sub-agent delegations (which models did what).
    if (ticket.orchestrated) {
      const delegations = readDelegations(ticket.id);
      if (delegations.length > 0) {
        const updated = await ticketStore.update(ticket.id, { delegations });
        if (updated) broadcaster.broadcast({ type: 'ticket:update', ticket: updated });
      }
    }
    const evaluation = await evalStore.upsertFromTicket(ticket);
    broadcaster.broadcast({ type: 'evaluation:update', evaluation });
  },
  concurrency: Number(process.env.CLAUDE_ALIVE_TICKET_CONCURRENCY) || 3,
});
if (!process.env.CLAUDE_ALIVE_TICKET_ROOTS) {
  // bypassPermissions is RCE-equivalent; the ticket routes are loopback-only
  // (see httpRouter) and this warns that no cwd allowlist is narrowing them.
  console.warn(
    '[tickets] CLAUDE_ALIVE_TICKET_ROOTS is unset — autonomous agents may run in any cwd. ' +
      'Ticket routes are loopback-only; set an allowlist to further restrict.',
  );
}

// ── Orchestration backends ───────────────────────────────────────────────────
// litellm is the first sub-agent delegation target; its key lives in server env
// only (never sent to the browser). The registry powers the onboarding surface.
function findOnPath(bin: string): string | null {
  for (const dir of (augmentPath(process.env.PATH) ?? '').split(':')) {
    if (!dir) continue;
    try {
      if (statSync(join(dir, bin)).isFile()) return join(dir, bin);
    } catch {
      // not here — keep looking
    }
  }
  return null;
}
const litellmClient = process.env.LITELLM_KEY
  ? createLitellmClient({
      baseUrl: process.env.LITELLM_BASE_URL ?? 'https://litellm.must.codes',
      apiKey: process.env.LITELLM_KEY,
    })
  : undefined;
const backendRegistry = createBackendRegistry({
  litellm: litellmClient,
  findClaude: () => findOnPath('claude'),
});

const httpServer = createHttpServer({
  onEvent,
  getSnapshot,
  tickets: {
    // Reject a bad cwd up front with a clear message. Without this, a
    // nonexistent/relative cwd fails deep in spawn as a cryptic ENOENT
    // ("failed to spawn claude").
    validateCwd: (cwd, isRemote) => {
      if (!isAbsolute(cwd)) {
        return isRemote
          ? 'Remote path must be absolute (e.g. /Users/dev/project). "~" is not expanded.'
          : 'Working directory must be an absolute path (e.g. /Users/you/project)';
      }
      // Remote (ssh) paths live on another machine — don't stat the local fs.
      // The runner validates the remote directory over SSH (`ssh test -d`).
      if (isRemote) return null;
      try {
        if (!statSync(cwd).isDirectory()) return 'Working directory is not a directory';
      } catch {
        return `Working directory does not exist: ${cwd}`;
      }
      return null;
    },
    list: () => ticketStore.list(),
    create: async (input) => {
      const ticket = await ticketStore.create(input);
      ticketRunner.enqueue(ticket);
      broadcaster.broadcast({ type: 'ticket:update', ticket });
      return ticket;
    },
    retry: (id) => ticketRunner.retry(id),
    reply: (id, prompt) => ticketRunner.reply(id, prompt),
    cancel: (id) => ticketRunner.cancel(id),
    remove: (id) => ticketStore.remove(id),
    evaluate: async (id, input) => {
      // Ensure a record exists first: tickets that settled before the eval loop
      // (or on an older server) have no record yet, so seed one from the ticket
      // before applying the human label.
      if (!evalStore.get(id)) {
        const ticket = ticketStore.get(id);
        if (ticket) await evalStore.upsertFromTicket(ticket);
      }
      const evaluation = await evalStore.setLabel(id, input);
      if (evaluation) broadcaster.broadcast({ type: 'evaluation:update', evaluation });
      return evaluation;
    },
    listEvaluations: () => evalStore.list(),
  },
  renameAgent,
  removeAgent,
  getStats: () => store.getStats(),
  getCompletedArchive,
  getProjectNames,
  saveProjectName,
  removeProjectName,
  efficio,
  backends: {
    list: () => backendRegistry.list(),
    check: async (id: string) =>
      id === 'claude-local' || id === 'litellm' || id === 'ssh' ? backendRegistry.check(id) : null,
  },
  sshBrowse: async (target, path) => {
    try {
      return await sshListDirs(target, path);
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'ssh browse failed' };
    }
  },
  workspaceTree: canonicalPipeline.enabled ? () => canonicalPipeline.tree() : undefined,
  sessionConversation: canonicalPipeline.enabled
    ? (sessionId, cursor) => canonicalPipeline.conversation(sessionId, cursor)
    : undefined,
  sessionTerminal: canonicalPipeline.enabled
    ? (sessionId) =>
        resolveSessionTerminal(sessionId, {
          findProviderRef: (id) => canonicalPipeline.findProviderRef(id),
          // The managed registry is what remembers which tab owned a session.
          findTabId: (claudeSessionId) =>
            getManagedSessions().find((r) => r.claudeSessionId === claudeSessionId)?.tabId,
          isLive: (tabId) => terminalManager.isLive(tabId),
        })
    : undefined,
  promptRouter: (req, res) => {
    if (!promptSubsystem) {
      // Explicit over a confusing 404: the route exists, the subsystem does not.
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'prompt subsystem unavailable', detail: 'see server logs' }));
      return;
    }
    promptSubsystem.fastify.routing(req, res);
  },
  onProjectNamesChanged: () => {
    // Push the new map to every connected client so the sidebar & tabs update instantly.
    broadcaster.broadcast({ type: 'project:names', names: getProjectNames() });
    // Also refresh the display name of every live agent whose cwd has a project name now.
    for (const agent of store.getAllAgents()) {
      const desired = agent.cwd ? getProjectName(agent.cwd) : undefined;
      if (desired !== undefined && desired !== agent.displayName) {
        const ok = store.renameAgent(agent.sessionId, desired);
        if (ok) {
          broadcaster.broadcast({ type: 'agent:rename', sessionId: agent.sessionId, name: desired });
        }
      }
    }
  },
});
// Server-owned terminals, keyed by stable tabId and decoupled from the WS.
// `send` forward-references `broadcaster` (assigned just below); it's only
// invoked at message time, long after both are initialised.
const terminalManager = new TerminalManager({
  send: (ws, m) => broadcaster.send(ws, m),
  // A pty exiting (or failing to spawn) makes its session resumable — tell every
  // connected client immediately instead of waiting for an unrelated event.
  onTerminalExit: () => broadcastResumable(),
});

// Throttles lastActive persistence per tab so active typing doesn't hammer disk.
const lastTouchAt = new Map<string, number>();
const TOUCH_THROTTLE_MS = 15_000;

const broadcaster = new WSBroadcaster({
  getSnapshot,
  onClientMessage: (ws, msg) => {
    if (msg.type === 'terminal:spawn') {
      // Idempotent: a spawn for a tab we already own is treated as a reattach.
      if (terminalManager.has(msg.tabId)) {
        terminalManager.attach(msg.tabId, ws);
        return;
      }
      // Remember every Claude session UUID we mint or resume so the hook handler can
      // distinguish UI-spawned sessions from external CLI invocations.
      if (msg.claudeSessionId) managedSessionIds.add(msg.claudeSessionId);
      if (msg.resumeSessionId) managedSessionIds.add(msg.resumeSessionId);
      // `claude agents` can't echo our session id back via --session-id, so no
      // real SessionStart hook ever matches this tab. Register a placeholder
      // agent now so the sidebar shows it grouped by project, consistent with
      // the terminal session. (No-op for the normal `claude` variant.)
      const placeholder = buildSpawnPlaceholderEvent(msg);
      if (placeholder) onEvent(placeholder);
      // If the client didn't supply a displayName, fall back to the stored project name for this cwd.
      // This is what makes the Claude CLI /resume picker, sidebar, and tab label all share one name.
      const resolvedDisplayName =
        msg.displayName ?? (msg.cwd ? getProjectName(msg.cwd) : undefined);
      terminalManager.create(ws, {
        tabId: msg.tabId,
        cwd: msg.cwd,
        mode: msg.mode ?? 'claude',
        source: msg.source ?? 'local',
        claudeVariant: msg.claudeVariant ?? 'claude',
        skipPermissions: msg.skipPermissions,
        initialCommand: msg.initialCommand,
        claudeSessionId: msg.claudeSessionId,
        resumeSessionId: msg.resumeSessionId,
        displayName: resolvedDisplayName,
      });
      // Persist Claude (non-SSH) sessions so they can be resumed after a restart.
      const effectiveClaudeId = msg.resumeSessionId ?? msg.claudeSessionId;
      if ((msg.mode ?? 'claude') === 'claude' && msg.source !== 'ssh' && effectiveClaudeId) {
        const now = Date.now();
        saveManagedSession({
          tabId: msg.tabId,
          claudeSessionId: effectiveClaudeId,
          cwd: msg.cwd,
          displayName: resolvedDisplayName,
          mode: 'claude',
          claudeVariant: msg.claudeVariant ?? 'claude',
          createdAt: now,
          lastActive: now,
        }).catch((err) => console.error(`[session] failed to persist ${msg.tabId}:`, err));
        lastTouchAt.set(msg.tabId, now);
      }
      broadcastResumable();
    } else if (msg.type === 'terminal:attach') {
      // Reattach after a browser refresh. Alive → restore scrollback; gone → dormant.
      const result = terminalManager.attach(msg.tabId, ws);
      if (result === 'missing') {
        const rec = getManagedSession(msg.tabId);
        if (rec) {
          broadcaster.send(ws, {
            type: 'terminal:dormant',
            tabId: rec.tabId,
            claudeSessionId: rec.claudeSessionId,
          });
        } else {
          // No live pty and no persisted record (record lost/evicted, or the tab
          // predates persistence). Always reply so the client isn't left with a
          // blank terminal — it resumes from its own persisted claudeSessionId.
          broadcaster.send(ws, { type: 'terminal:missing', tabId: msg.tabId });
        }
      }
    } else if (msg.type === 'terminal:input') {
      terminalManager.input(msg.tabId, msg.data);
      const now = Date.now();
      const prev = lastTouchAt.get(msg.tabId) ?? 0;
      if (now - prev > TOUCH_THROTTLE_MS && getManagedSession(msg.tabId)) {
        lastTouchAt.set(msg.tabId, now);
        touchManagedSession(msg.tabId, now).catch((err) =>
          console.error(`[session] failed to touch ${msg.tabId}:`, err),
        );
      }
    } else if (msg.type === 'terminal:resize') {
      terminalManager.resize(msg.tabId, msg.cols, msg.rows);
    } else if (msg.type === 'terminal:close') {
      // Drop the session UUID from the provenance set so it doesn't grow for the
      // life of the process — the record's claudeSessionId is the only handle to it.
      const rec = getManagedSession(msg.tabId);
      if (rec) managedSessionIds.delete(rec.claudeSessionId);
      terminalManager.close(msg.tabId);
      removeManagedSession(msg.tabId).catch((err) =>
        console.error(`[session] failed to remove ${msg.tabId}:`, err),
      );
      lastTouchAt.delete(msg.tabId);
      broadcastResumable();
    }
  },
  onClientDisconnect: (ws) => {
    // Drop this client's subscriptions only — ptys keep running so a refresh
    // (or another browser) can reattach and replay the scrollback.
    terminalManager.detachClient(ws);
  },
});

httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (pathname === '/ws') {
    broadcaster.handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

// Host CPU/RAM metrics poller. 2s cadence is smooth for a header indicator without
// meaningful CPU cost (os.cpus() + os.freemem() are cheap syscalls).
const metricsPoller = new SystemMetricsPoller(2000);
metricsPoller.subscribe((snapshot) => {
  broadcaster.broadcast({
    type: 'system:metrics',
    cpu: snapshot.cpu,
    memUsed: snapshot.memUsed,
    memTotal: snapshot.memTotal,
    timestamp: snapshot.timestamp,
  });
});
metricsPoller.start();

// Watch ~/.efficio for DB changes and push fresh status to clients. efficio
// `collect`/`fit` rewrites the SQLite store (multiple fs events) → debounce.
// Directory watch (not file) so we also catch first-time DB creation.
const efficioDir = dirname(efficio.dbPath);
let efficioWatcher: ReturnType<typeof watch> | null = null;
if (existsSync(efficioDir)) {
  let efficioDebounce: ReturnType<typeof setTimeout> | null = null;
  try {
    efficioWatcher = watch(efficioDir, (_event, filename) => {
      if (filename && !filename.startsWith('efficio.db')) return;
      if (efficioDebounce) clearTimeout(efficioDebounce);
      efficioDebounce = setTimeout(() => {
        broadcaster.broadcast({ type: 'efficio:update', status: efficio.status() });
      }, 400);
    });
  } catch {
    // fs.watch unsupported on this platform/path — UI still works via HTTP polling on demand.
  }
}

// Start the prompt-worker queue consumer in-process. No pidfile, no fork:
// the worker shares the server process lifecycle. Errors inside the loop
// are logged but never bubble up to take the server down.
const stopWorkerLoop = startWorkerLoop();

// Reconcile tickets left in flight by a previous run: in-flight → failed
// (interrupted, not reattachable), queued → re-scheduled. Runs now that the
// broadcaster exists so state changes reach connected clients.
void ticketRunner.recover();

httpServer.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║        claude-alive server           ║
  ║                                      ║
  ║  HTTP:  http://localhost:${PORT}       ║
  ║  WS:    ws://localhost:${PORT}/ws      ║
  ╚══════════════════════════════════════╝
  `);
});

// Ignore SIGHUP so the server survives terminal close (daemon mode)
process.on('SIGHUP', () => {});

process.on('SIGINT', () => {
  console.log('\n[server] shutting down...');
  // terminals cleaned up via onClientDisconnect
  for (const timer of despawnTimers.values()) clearTimeout(timer);
  despawnTimers.clear();
  metricsPoller.stop();
  efficioCollector.stop();
  efficioWatcher?.close();
  stopWorkerLoop();
  canonicalPipeline.close();
  promptSubsystem?.fastify.close().catch(() => {});
  promptSubsystem?.close();
  broadcaster.close();
  httpServer.close();
  process.exit(0);
});

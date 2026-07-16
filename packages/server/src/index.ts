import { SessionStore, parseTranscriptTokens } from '@claude-alive/core';
import type { HookEventPayload } from '@claude-alive/core';
import { createPromptSubsystem } from '@think-prompt/agent';
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
import { SystemMetricsPoller } from './systemMetrics.js';
import { startWorkerLoop } from './promptWorker.js';
import { createEfficioReader } from './efficioReader.js';
import { createEfficioCollector, resolveEfficioRoot } from './efficioCollector.js';
import { watch, existsSync } from 'node:fs';
import { dirname } from 'node:path';

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

// Absorbed think-prompt subsystem. Owns its own SQLite handle and a
// Fastify instance mounted onto our shared http.Server below; no second
// port, no separate daemon. `ingest` is called from onEvent() to fan the
// same hook payload into the prompt-quality pipeline.
const promptSubsystem = createPromptSubsystem();
await promptSubsystem.fastify.ready();

const despawnTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Read-only bridge to efficio's SQLite store (~/.efficio/efficio.db). The
// server never computes statistics — efficio (Python) writes pre-scored rows;
// we only read them. Absent/empty DB degrades gracefully to available:false.
const efficio = createEfficioReader();

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
  promptSubsystem.ingest(payload);

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
    // Check if a completion was recorded (agent was in done state)
    const completedSessions = store.getCompletedSessions();
    const completed = completedSessions.find(c => c.sessionId === agent.sessionId);
    if (completed) {
      broadcaster.broadcast({ type: 'agent:completed', session: completed });
      // Delay despawn by 30s so the done state is visible in UI
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

    // Async transcript parsing (non-blocking)
    if (agent.transcriptPath) {
      parseTranscriptTokens(agent.transcriptPath).then((usage) => {
        if (usage) {
          const current = store.getAgent(agent.sessionId);
          if (current) {
            current.tokenUsage = usage;
          }
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

const httpServer = createHttpServer({
  onEvent,
  getSnapshot,
  renameAgent,
  removeAgent,
  getStats: () => store.getStats(),
  getProjectNames,
  saveProjectName,
  removeProjectName,
  efficio,
  promptRouter: (req, res) => {
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
        }
        // else: a tab the server never knew about (stale) — the client drops it.
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
  promptSubsystem.fastify.close().catch(() => {});
  promptSubsystem.close();
  broadcaster.close();
  httpServer.close();
  process.exit(0);
});

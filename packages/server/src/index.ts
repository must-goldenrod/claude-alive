import { SessionStore, parseTranscriptTokens } from '@claude-alive/core';
import type { HookEventPayload } from '@claude-alive/core';
import type { WebSocket } from 'ws';
import { createHttpServer } from './httpRouter.js';
import { WSBroadcaster } from './wsServer.js';
import { ClaudeTerminal } from './claudeTerminal.js';
import { loadNames, getNames, saveName, removeName } from './nameStore.js';
import {
  loadProjectNames,
  getProjectName,
  getProjectNames,
  saveProjectName,
  removeProjectName,
} from './projectNameStore.js';
import { SystemMetricsPoller } from './systemMetrics.js';

const PORT = parseInt(process.env.CLAUDE_ALIVE_PORT ?? '3141', 10);

const store = new SessionStore();
// Load persisted names before starting the server. Project names (cwd-keyed) are the
// primary source of truth; the old sessionId-keyed nameStore is kept as a secondary
// fallback for agents whose cwd isn't in projectNames yet.
await loadNames();
await loadProjectNames();

const despawnTimers = new Map<string, ReturnType<typeof setTimeout>>();

function getSnapshot() {
  return {
    agents: store.getAllAgents(),
    recentEvents: store.getRecentEvents(100),
    completedSessions: store.getCompletedSessions(),
    stats: store.getStats(),
  };
}

function onEvent(payload: HookEventPayload): void {
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

// Per-client, per-tab terminal instances
const terminals = new Map<WebSocket, Map<string, ClaudeTerminal>>();

function getOrCreateTabMap(ws: WebSocket): Map<string, ClaudeTerminal> {
  let tabMap = terminals.get(ws);
  if (!tabMap) {
    tabMap = new Map();
    terminals.set(ws, tabMap);
  }
  return tabMap;
}

const httpServer = createHttpServer({ onEvent, getSnapshot, renameAgent, removeAgent, getStats: () => store.getStats() });
const broadcaster = new WSBroadcaster({
  getSnapshot,
  onClientMessage: (ws, msg) => {
    if (msg.type === 'terminal:spawn') {
      const tabMap = getOrCreateTabMap(ws);
      if (tabMap.has(msg.tabId)) return; // already exists
      const term = new ClaudeTerminal();
      tabMap.set(msg.tabId, term);
      const isSsh = msg.source === 'ssh';
      // If the client didn't supply a displayName, fall back to the stored project name for this cwd.
      // This is what makes the Claude CLI /resume picker, sidebar, and tab label all share one name.
      const resolvedDisplayName =
        msg.displayName ?? (msg.cwd ? getProjectName(msg.cwd) : undefined);
      term.spawn({
        handler: (data) => {
          broadcaster.send(ws, { type: 'terminal:output', tabId: msg.tabId, data });
        },
        cols: 80,
        rows: 24,
        onExit: (exitCode) => {
          broadcaster.send(ws, { type: 'terminal:exited', tabId: msg.tabId, exitCode });
        },
        onSshError: isSsh
          ? (err) => {
              broadcaster.send(ws, {
                type: 'terminal:ssh-error',
                tabId: msg.tabId,
                kind: err.kind,
                line: err.line,
              });
            }
          : undefined,
        cwd: msg.cwd,
        mode: msg.mode ?? 'claude',
        skipPermissions: msg.skipPermissions,
        initialCommand: msg.initialCommand,
        detectSshErrors: isSsh,
        claudeSessionId: msg.claudeSessionId,
        resumeSessionId: msg.resumeSessionId,
        displayName: resolvedDisplayName,
      });
    } else if (msg.type === 'terminal:input') {
      const term = terminals.get(ws)?.get(msg.tabId);
      if (term) term.write(msg.data);
    } else if (msg.type === 'terminal:resize') {
      const term = terminals.get(ws)?.get(msg.tabId);
      if (term) term.resize(msg.cols, msg.rows);
    } else if (msg.type === 'terminal:close') {
      const tabMap = terminals.get(ws);
      const term = tabMap?.get(msg.tabId);
      if (term) {
        term.destroy();
        tabMap!.delete(msg.tabId);
      }
    }
  },
  onClientDisconnect: (ws) => {
    const tabMap = terminals.get(ws);
    if (tabMap) {
      for (const term of tabMap.values()) term.destroy();
      tabMap.clear();
      terminals.delete(ws);
    }
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
  broadcaster.close();
  httpServer.close();
  process.exit(0);
});

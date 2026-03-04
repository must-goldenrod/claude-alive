import { SessionStore, parseTranscriptTokens } from '@claude-alive/core';
import type { HookEventPayload } from '@claude-alive/core';
import { createHttpServer } from './httpRouter.js';
import { WSBroadcaster } from './wsServer.js';
import { ClaudeChat } from './claudeChat.js';
import { loadNames, getNames, saveName, removeName } from './nameStore.js';

const PORT = parseInt(process.env.CLAUDE_ALIVE_PORT ?? '3141', 10);

const store = new SessionStore();
// Load persisted agent names before starting the server
await loadNames();

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
    // Restore saved name for newly created agents
    const savedName = getNames()[agent.sessionId];
    if (savedName) {
      store.renameAgent(agent.sessionId, savedName);
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

const claudeChat = new ClaudeChat();

const httpServer = createHttpServer({ onEvent, getSnapshot, renameAgent, removeAgent, getStats: () => store.getStats() });
const broadcaster = new WSBroadcaster({
  getSnapshot,
  onClientMessage: (ws, msg) => {
    if (msg.type === 'chat:send') {
      claudeChat.send(msg.message, {
        onChunk: (text, sessionId) => broadcaster.send(ws, { type: 'chat:chunk', text, sessionId }),
        onEnd: (sessionId, costUsd) => broadcaster.send(ws, { type: 'chat:end', sessionId, costUsd }),
        onError: (error, sessionId) => broadcaster.send(ws, { type: 'chat:error', error, sessionId }),
      });
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

process.on('SIGINT', () => {
  console.log('\n[server] shutting down...');
  claudeChat.destroy();
  for (const timer of despawnTimers.values()) clearTimeout(timer);
  despawnTimers.clear();
  broadcaster.close();
  httpServer.close();
  process.exit(0);
});

import { SessionStore } from '@claude-alive/core';
import type { HookEventPayload } from '@claude-alive/core';
import { createHttpServer } from './httpRouter.js';
import { WSBroadcaster } from './wsServer.js';

const PORT = parseInt(process.env.CLAUDE_ALIVE_PORT ?? '3141', 10);

const store = new SessionStore();

function getSnapshot() {
  return {
    agents: store.getAllAgents(),
    recentEvents: store.getRecentEvents(100),
  };
}

function onEvent(payload: HookEventPayload): void {
  const agent = store.processEvent(payload);
  if (!agent) return;

  const event = payload.event;

  if (event === 'SessionStart' || event === 'SubagentStart') {
    broadcaster.broadcast({ type: 'agent:spawn', agent });
  } else if (event === 'SessionEnd' || event === 'SubagentStop') {
    broadcaster.broadcast({ type: 'agent:despawn', sessionId: agent.sessionId });
  } else if (event === 'UserPromptSubmit' && payload.data.prompt) {
    broadcaster.broadcast({ type: 'agent:prompt', sessionId: agent.sessionId, prompt: payload.data.prompt });
    broadcaster.broadcast({
      type: 'agent:state',
      sessionId: agent.sessionId,
      state: agent.state,
      tool: agent.currentTool,
      animation: agent.currentToolAnimation,
    });
  } else {
    broadcaster.broadcast({
      type: 'agent:state',
      sessionId: agent.sessionId,
      state: agent.state,
      tool: agent.currentTool,
      animation: agent.currentToolAnimation,
    });
  }

  const recentEvents = store.getRecentEvents(1);
  if (recentEvents.length > 0) {
    broadcaster.broadcast({ type: 'event:new', entry: recentEvents[recentEvents.length - 1]! });
  }
}

function renameAgent(sessionId: string, name: string | null): boolean {
  return store.renameAgent(sessionId, name);
}

function removeAgent(sessionId: string): boolean {
  const ok = store.removeAgent(sessionId);
  if (ok) {
    broadcaster.broadcast({ type: 'agent:despawn', sessionId });
  }
  return ok;
}

const httpServer = createHttpServer({ onEvent, getSnapshot, renameAgent, removeAgent });
const broadcaster = new WSBroadcaster(httpServer, { getSnapshot });

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
  broadcaster.close();
  httpServer.close();
  process.exit(0);
});

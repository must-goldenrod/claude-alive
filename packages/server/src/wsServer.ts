import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { WSServerMessage, WSClientMessage } from '@claude-alive/core';
import { PtyManager } from './ptyManager.js';

const MAX_CLIENTS = 50;

export interface WSBroadcasterOptions {
  getSnapshot: () => { agents: unknown[]; recentEvents: unknown[]; completedSessions: unknown[]; stats: unknown };
  maxClients?: number;
}

export class WSBroadcaster {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private getSnapshot: WSBroadcasterOptions['getSnapshot'];
  private maxClients: number;

  constructor(server: Server, options: WSBroadcasterOptions) {
    this.getSnapshot = options.getSnapshot;
    this.maxClients = options.maxClients ?? MAX_CLIENTS;
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      if (this.clients.size >= this.maxClients) {
        ws.close(1013, 'Too many connections');
        return;
      }
      this.clients.add(ws);
      console.log(`[ws] client connected (${this.clients.size} total)`);

      this.send(ws, { type: 'snapshot', ...this.getSnapshot() } as WSServerMessage);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as WSClientMessage;
          if (msg.type === 'ping') {
            this.send(ws, { type: 'system:heartbeat', timestamp: Date.now() });
          } else if (msg.type === 'request:snapshot') {
            this.send(ws, { type: 'snapshot', ...this.getSnapshot() } as WSServerMessage);
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[ws] client disconnected (${this.clients.size} total)`);
      });
    });

    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: 'system:heartbeat', timestamp: Date.now() });
    }, 30_000);
  }

  broadcast(message: WSServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(data);
      }
    }
  }

  private send(ws: WebSocket, message: WSServerMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.wss.close();
  }
}

export class TerminalWSServer {
  private wss: WebSocketServer;
  private ptyManager: PtyManager;

  constructor(server: Server, ptyManager: PtyManager) {
    this.ptyManager = ptyManager;
    this.wss = new WebSocketServer({ server, path: '/ws/terminal' });

    this.wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(ws, msg);
        } catch { /* ignore malformed */ }
      });
    });
  }

  private handleMessage(ws: WebSocket, msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'terminal:create': {
        const cwd = typeof msg.cwd === 'string' ? msg.cwd : (process.env.HOME || '/');
        const session = this.ptyManager.createSession(cwd);
        if (!session) {
          ws.send(JSON.stringify({ type: 'terminal:error', error: 'Max sessions reached' }));
          return;
        }
        this.ptyManager.onOutput(session.id, (data) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'terminal:output', sessionId: session.id, data }));
          }
        });
        this.ptyManager.onExit(session.id, (exitCode) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'terminal:exited', sessionId: session.id, exitCode }));
          }
        });
        ws.send(JSON.stringify({ type: 'terminal:created', sessionId: session.id }));
        break;
      }
      case 'terminal:input': {
        if (typeof msg.sessionId === 'string' && typeof msg.data === 'string') {
          this.ptyManager.writeInput(msg.sessionId, msg.data);
        }
        break;
      }
      case 'terminal:resize': {
        if (typeof msg.sessionId === 'string' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          this.ptyManager.resize(msg.sessionId, msg.cols, msg.rows);
        }
        break;
      }
      case 'terminal:destroy': {
        if (typeof msg.sessionId === 'string') {
          this.ptyManager.destroySession(msg.sessionId);
        }
        break;
      }
    }
  }

  close(): void {
    this.ptyManager.destroyAll();
    this.wss.close();
  }
}

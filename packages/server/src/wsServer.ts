import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { WSServerMessage, WSClientMessage } from '@claude-alive/core';

export interface WSBroadcasterOptions {
  getSnapshot: () => { agents: unknown[]; recentEvents: unknown[] };
}

export class WSBroadcaster {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private getSnapshot: WSBroadcasterOptions['getSnapshot'];

  constructor(server: Server, options: WSBroadcasterOptions) {
    this.getSnapshot = options.getSnapshot;
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
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

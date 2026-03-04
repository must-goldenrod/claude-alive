import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WSServerMessage, WSClientMessage } from '@claude-alive/core';

const MAX_CLIENTS = 50;

export interface WSBroadcasterOptions {
  getSnapshot: () => { agents: unknown[]; recentEvents: unknown[]; completedSessions: unknown[]; stats: unknown };
  maxClients?: number;
  onClientMessage?: (ws: WebSocket, msg: WSClientMessage) => void;
}

export class WSBroadcaster {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private getSnapshot: WSBroadcasterOptions['getSnapshot'];
  private maxClients: number;
  private onClientMessage?: WSBroadcasterOptions['onClientMessage'];

  constructor(options: WSBroadcasterOptions) {
    this.getSnapshot = options.getSnapshot;
    this.maxClients = options.maxClients ?? MAX_CLIENTS;
    this.onClientMessage = options.onClientMessage;
    this.wss = new WebSocketServer({ noServer: true });

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
          } else {
            this.onClientMessage?.(ws, msg);
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

  send(ws: WebSocket, message: WSServerMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  close(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.wss.close();
  }
}

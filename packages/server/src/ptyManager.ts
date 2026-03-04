import { spawn, type IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';

export interface PtySession {
  id: string;
  pty: IPty;
  createdAt: number;
}

export interface PtyManagerOptions {
  maxSessions: number;
  inactivityTimeoutMs?: number;
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();
  private maxSessions: number;
  private inactivityTimeoutMs: number;
  private inactivityTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: PtyManagerOptions) {
    this.maxSessions = options.maxSessions;
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? 30 * 60 * 1000;
  }

  createSession(cwd: string): PtySession | null {
    if (this.sessions.size >= this.maxSessions) return null;

    const id = randomUUID();
    const shell = process.env.SHELL || '/bin/zsh';
    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    });

    const session: PtySession = { id, pty, createdAt: Date.now() };
    this.sessions.set(id, session);
    this.resetInactivityTimer(id);
    return session;
  }

  writeInput(id: string, data: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.write(data);
    this.resetInactivityTimer(id);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.resize(cols, rows);
    return true;
  }

  onOutput(id: string, callback: (data: string) => void): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.onData(callback);
    return true;
  }

  onExit(id: string, callback: (exitCode: number) => void): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.clearInactivityTimer(id);
      callback(exitCode);
    });
    return true;
  }

  destroySession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.kill();
    this.sessions.delete(id);
    this.clearInactivityTimer(id);
    return true;
  }

  listSessions(): { id: string; createdAt: number }[] {
    return Array.from(this.sessions.values()).map(s => ({ id: s.id, createdAt: s.createdAt }));
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroySession(id);
    }
  }

  private resetInactivityTimer(id: string): void {
    this.clearInactivityTimer(id);
    this.inactivityTimers.set(id, setTimeout(() => {
      this.destroySession(id);
    }, this.inactivityTimeoutMs));
  }

  private clearInactivityTimer(id: string): void {
    const timer = this.inactivityTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.inactivityTimers.delete(id);
    }
  }
}

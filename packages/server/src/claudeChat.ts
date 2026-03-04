import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface ChatHandler {
  onChunk: (text: string, sessionId: string) => void;
  onEnd: (sessionId: string, costUsd?: number) => void;
  onError: (error: string, sessionId: string | null) => void;
}

export class ClaudeChat {
  private proc: ChildProcess | null = null;
  private sessionId: string | null = null;

  send(message: string, handler: ChatHandler): void {
    // Kill previous process if still running
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }

    const args = ['-p', message, '--output-format', 'stream-json'];
    if (this.sessionId) {
      args.push('--resume', this.sessionId);
    }

    const proc = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.proc = proc;

    const rl = createInterface({ input: proc.stdout! });
    let currentSessionId = this.sessionId;

    rl.on('line', (line) => {
      try {
        const obj = JSON.parse(line);

        // Capture session ID from the first message
        if (obj.session_id && !currentSessionId) {
          currentSessionId = obj.session_id;
          this.sessionId = obj.session_id;
        }

        if (obj.type === 'assistant' && Array.isArray(obj.content)) {
          for (const block of obj.content) {
            if (block.type === 'text' && block.text) {
              handler.onChunk(block.text, currentSessionId ?? 'unknown');
            }
          }
        }

        if (obj.type === 'result') {
          if (obj.session_id) {
            this.sessionId = obj.session_id;
            currentSessionId = obj.session_id;
          }
          const cost = obj.cost_usd ?? obj.costUsd;
          handler.onEnd(currentSessionId ?? 'unknown', cost);
        }
      } catch {
        // Skip non-JSON lines
      }
    });

    let stderrBuf = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.on('error', (err) => {
      handler.onError(err.message, currentSessionId);
      this.proc = null;
    });

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        const msg = stderrBuf.trim() || `claude exited with code ${code}`;
        handler.onError(msg, currentSessionId);
      }
      if (this.proc === proc) {
        this.proc = null;
      }
    });
  }

  destroy(): void {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }
}

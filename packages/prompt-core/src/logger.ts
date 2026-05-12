import { type WriteStream, createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';
import { type Logger, pino } from 'pino';

// Cache file streams by path so multiple loggers sharing the same file don't fight.
const streams = new Map<string, WriteStream>();

function getFileStream(path: string): WriteStream | null {
  const existing = streams.get(path);
  if (existing && !existing.destroyed) return existing;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const s = createWriteStream(path, { flags: 'a' });
    s.on('error', () => {
      // Swallow. We never want logging failures to crash the agent.
    });
    streams.set(path, s);
    return s;
  } catch {
    return null;
  }
}

class MultiStream extends Writable {
  constructor(private dests: NodeJS.WritableStream[]) {
    super();
  }
  override _write(
    chunk: Buffer | string | Uint8Array,
    _enc: string,
    cb: (err?: Error | null) => void
  ): void {
    for (const d of this.dests) {
      try {
        d.write(chunk);
      } catch {
        // ignore
      }
    }
    cb();
  }
}

export function createLogger(
  name: string,
  opts: { level?: string; file?: string; stdout?: boolean } = {}
): Logger {
  const level = opts.level ?? process.env.LOG_LEVEL ?? 'info';
  const destinations: NodeJS.WritableStream[] = [];
  if (opts.file) {
    const fs = getFileStream(opts.file);
    if (fs) destinations.push(fs);
  }
  const wantStdout = opts.stdout ?? destinations.length === 0;
  if (wantStdout) destinations.push(process.stdout);
  if (destinations.length === 0) destinations.push(process.stdout);
  const target = destinations.length === 1 ? destinations[0]! : new MultiStream(destinations);
  return pino({ name, level, base: { pid: process.pid } }, target);
}

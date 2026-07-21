/**
 * Parser for `claude -p --output-format stream-json` output.
 *
 * Claude Code headless mode emits one JSON object per line on stdout. We only
 * need to distinguish three things for a ticket: the session id (init), that
 * work is happening (activity — deliberately opaque, never shown to the user),
 * and the final result. Everything else is classified `unknown` and ignored.
 *
 * A malformed line is skipped, never thrown: one corrupt line must not kill an
 * otherwise-healthy run (spec §에러 처리).
 */

export interface StreamResult {
  /** The agent's final summary text. */
  result: string | null;
  isError: boolean;
  sessionId: string | null;
  /** e.g. "success", "error_max_turns", "error_during_execution". */
  subtype: string | null;
}

export type StreamEvent =
  | { kind: 'init'; sessionId: string | null }
  | { kind: 'activity' }
  | { kind: 'result'; result: StreamResult };

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Parse a single stream-json line. Returns null for blank / malformed / unclassified lines. */
export function parseStreamJsonLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null; // fail-soft: skip, don't throw
  }

  const type = asString(obj.type);
  switch (type) {
    case 'system':
      // init carries the session id; other system subtypes are activity.
      if (obj.subtype === 'init') return { kind: 'init', sessionId: asString(obj.session_id) };
      return { kind: 'activity' };
    case 'assistant':
    case 'user':
      return { kind: 'activity' };
    case 'result':
      return {
        kind: 'result',
        result: {
          result: asString(obj.result),
          isError: obj.is_error === true,
          sessionId: asString(obj.session_id),
          subtype: asString(obj.subtype),
        },
      };
    default:
      return null;
  }
}

/**
 * Stateful line-buffering parser. Feed it raw stdout chunks; it emits one
 * StreamEvent per complete line and buffers any trailing partial line until the
 * next chunk (or flush).
 */
export function createStreamJsonParser(onEvent: (e: StreamEvent) => void) {
  let buffer = '';
  return {
    push(chunk: string): void {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const event = parseStreamJsonLine(line);
        if (event) onEvent(event);
      }
    },
    /** Emit any buffered trailing line (called once the stream closes). */
    flush(): void {
      if (buffer.trim()) {
        const event = parseStreamJsonLine(buffer);
        if (event) onEvent(event);
      }
      buffer = '';
    },
  };
}

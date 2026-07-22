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

export interface StreamUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  numTurns?: number;
  durationMs?: number;
}

export interface StreamResult {
  /** The agent's final summary text. */
  result: string | null;
  isError: boolean;
  sessionId: string | null;
  /** e.g. "success", "error_max_turns", "error_during_execution". */
  subtype: string | null;
  /** Model id that ran the turn, e.g. "claude-opus-4-8" (bracket suffix stripped). */
  model: string | null;
  /** Token/cost/turn accounting from the result event, when present. */
  usage: StreamUsage | null;
}

export type StreamEvent =
  | { kind: 'init'; sessionId: string | null }
  | { kind: 'activity' }
  | { kind: 'result'; result: StreamResult };

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Pull token/cost/turn accounting out of a result event. `modelUsage` is keyed by
 * model id and holds camelCase token counts; cost/turns/duration sit at the top
 * level (snake_case). Returns null when nothing usable is present.
 */
function extractUsage(obj: Record<string, unknown>): StreamUsage | null {
  const modelUsage = obj.modelUsage;
  let mu: Record<string, unknown> | undefined;
  if (modelUsage && typeof modelUsage === 'object') {
    const firstKey = Object.keys(modelUsage as Record<string, unknown>)[0];
    if (firstKey) mu = (modelUsage as Record<string, Record<string, unknown>>)[firstKey];
  }

  const inputTokens = asNum(mu?.inputTokens);
  const outputTokens = asNum(mu?.outputTokens);
  const cacheReadTokens = asNum(mu?.cacheReadInputTokens);
  const cacheCreationTokens = asNum(mu?.cacheCreationInputTokens);
  const costUsd = asNum(obj.total_cost_usd) ?? asNum(mu?.costUSD);
  const numTurns = asNum(obj.num_turns);
  const durationMs = asNum(obj.duration_ms);

  const tokenParts = [inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens].filter(
    (n): n is number => n !== undefined,
  );
  const totalTokens = tokenParts.length > 0 ? tokenParts.reduce((a, b) => a + b, 0) : undefined;

  const usage: StreamUsage = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens,
    costUsd,
    numTurns,
    durationMs,
  };
  return Object.values(usage).some((v) => v !== undefined) ? usage : null;
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
    case 'result': {
      // modelUsage is keyed by model id (e.g. "claude-opus-4-8[1m]"); take the
      // first key and strip any "[…]" context-window suffix.
      const modelUsage = obj.modelUsage;
      let model: string | null = null;
      if (modelUsage && typeof modelUsage === 'object') {
        const first = Object.keys(modelUsage as Record<string, unknown>)[0];
        if (first) model = first.replace(/\[.*\]$/, '');
      }
      return {
        kind: 'result',
        result: {
          result: asString(obj.result),
          isError: obj.is_error === true,
          sessionId: asString(obj.session_id),
          subtype: asString(obj.subtype),
          model,
          usage: extractUsage(obj),
        },
      };
    }
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

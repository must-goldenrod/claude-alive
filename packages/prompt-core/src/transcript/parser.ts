/**
 * Transcript JSONL parser — docs/04-transcript-parser.md.
 * Format assumptions come from Claude Code internals; all field access is optional.
 * M0 observation will confirm actual field names.
 */
import { existsSync, readFileSync } from 'node:fs';

export type EventKind =
  | 'user'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'system'
  | 'subagent'
  | 'unknown';

export interface TranscriptEvent {
  raw: unknown;
  kind: EventKind;
  text?: string | undefined;
  role?: string | undefined;
  ts?: string | undefined;
  toolName?: string | undefined;
  toolInput?: unknown;
  toolResult?: unknown;
  toolUseId?: string | undefined;
  agentType?: string | undefined;
}

/**
 * Heuristic event classifier. The transcript JSONL format is not formally documented;
 * we accept a wide variety of shapes and fall through to 'unknown'.
 */
export function classifyEvent(obj: Record<string, unknown>): TranscriptEvent {
  const raw = obj;
  // Common shapes: { type, role, content } or { role, content } or { kind, data }
  const type = (obj.type ?? obj.event ?? obj.kind) as string | undefined;
  const role = obj.role as string | undefined;

  const extractText = (c: unknown): string | undefined => {
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      const parts: string[] = [];
      for (const item of c) {
        if (typeof item === 'string') parts.push(item);
        else if (item && typeof item === 'object') {
          const t = (item as Record<string, unknown>).text;
          if (typeof t === 'string') parts.push(t);
        }
      }
      return parts.length > 0 ? parts.join('\n') : undefined;
    }
    if (c && typeof c === 'object') {
      const t = (c as Record<string, unknown>).text;
      if (typeof t === 'string') return t;
    }
    return undefined;
  };

  const message = (obj.message ?? obj) as Record<string, unknown>;
  const content = message.content ?? obj.content;
  const text = extractText(content) ?? (typeof obj.text === 'string' ? obj.text : undefined);

  const ts =
    (typeof obj.timestamp === 'string' && obj.timestamp) ||
    (typeof obj.ts === 'string' && obj.ts) ||
    (typeof obj.time === 'string' && obj.time) ||
    undefined;

  // Role-based classification (most common)
  if (role === 'user' || type === 'user' || type === 'human') {
    return { raw, kind: 'user', role: 'user', text, ts };
  }
  if (role === 'assistant' || type === 'assistant') {
    return { raw, kind: 'assistant', role: 'assistant', text, ts };
  }
  if (role === 'system' || type === 'system') {
    return { raw, kind: 'system', role: 'system', text, ts };
  }

  // Tool-related
  if (type === 'tool_use' || type === 'tool-use' || obj.tool_name !== undefined) {
    return {
      raw,
      kind: 'tool_use',
      toolName: obj.tool_name as string | undefined,
      toolInput: obj.tool_input,
      toolUseId: obj.tool_use_id as string | undefined,
      ts,
    };
  }
  if (type === 'tool_result' || type === 'tool-result') {
    return {
      raw,
      kind: 'tool_result',
      toolUseId: (obj.tool_use_id ?? obj.toolUseId) as string | undefined,
      toolResult: obj.content ?? obj.result,
      ts,
    };
  }

  // Subagent boundary marker
  if (type && /subagent/i.test(type)) {
    return {
      raw,
      kind: 'subagent',
      agentType: obj.agent_type as string | undefined,
      text,
      ts,
    };
  }

  return { raw, kind: 'unknown', text, ts };
}

export function parseTranscriptString(text: string): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object') {
        out.push(classifyEvent(obj));
      }
    } catch {
      // Skip malformed lines silently; caller may log.
    }
  }
  return out;
}

export function parseTranscriptFile(path: string): TranscriptEvent[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  return parseTranscriptString(text);
}

export function extractFirstUserPrompt(events: TranscriptEvent[]): string | null {
  for (const e of events) {
    if (e.kind === 'user' && e.text) return e.text;
  }
  return null;
}

export function extractFinalAssistantText(events: TranscriptEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === 'assistant' && e.text) return e.text;
  }
  return null;
}

/** Summed tool-use / tool-result counts. */
export function summarizeToolUse(events: TranscriptEvent[]): { toolName: string; calls: number }[] {
  const map = new Map<string, number>();
  for (const e of events) {
    if (e.kind === 'tool_use' && e.toolName) {
      map.set(e.toolName, (map.get(e.toolName) ?? 0) + 1);
    }
  }
  return [...map.entries()].map(([toolName, calls]) => ({ toolName, calls }));
}

/**
 * D-046 §3.4.1: per-user-turn efficiency features.
 *
 * Walks the transcript in order and, for every `user` event, aggregates:
 *   - `toolCalls`   — tool_use events that happen before the next user turn
 *   - `firstShotSuccess` — 1 if the NEXT user turn does not look like a
 *     correction ("다시/아니/취소/redo/no wait"), 0 otherwise
 *   - `followUpDepth` — 1 for a fresh user turn, ++ when consecutive
 *     turns are correction-style (indicating the previous turn did not
 *     land cleanly)
 *
 * Returned in the same order as user turns appear in the transcript so
 * callers can zip with their own `turn_index` list.
 */
const CORRECTION_PATTERN =
  /(?:^|\s)(다시|아니|취소|재시도|redo|no\s*wait|잘못|wrong|undo)(?:$|\s|[.!?,])/i;

export interface TurnEfficiency {
  userTurnIndex: number; // index into events[] where the user event lives
  toolCalls: number;
  firstShotSuccess: 0 | 1;
  followUpDepth: number;
}

export function extractTurnEfficiency(events: TranscriptEvent[]): TurnEfficiency[] {
  const userIdxs: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.kind === 'user') userIdxs.push(i);
  }

  const out: TurnEfficiency[] = [];
  let depth = 1;
  for (let u = 0; u < userIdxs.length; u++) {
    const start = userIdxs[u]!;
    const end = u + 1 < userIdxs.length ? userIdxs[u + 1]! : events.length;

    let toolCalls = 0;
    for (let j = start + 1; j < end; j++) {
      if (events[j]!.kind === 'tool_use') toolCalls += 1;
    }

    // first-shot success = next user turn is NOT a correction.
    // Last turn defaults to 1 (no evidence of failure).
    let firstShot: 0 | 1 = 1;
    if (u + 1 < userIdxs.length) {
      const nextText = events[userIdxs[u + 1]!]?.text ?? '';
      if (CORRECTION_PATTERN.test(nextText)) firstShot = 0;
    }

    out.push({
      userTurnIndex: start,
      toolCalls,
      firstShotSuccess: firstShot,
      followUpDepth: depth,
    });

    // If the CURRENT turn was a correction, the NEXT turn's depth grows.
    const curText = events[start]?.text ?? '';
    depth = CORRECTION_PATTERN.test(curText) ? depth + 1 : 1;
  }

  return out;
}

/**
 * Claude JSONL transcript → conversation items (spec §F.7 "1순위").
 *
 * Hooks carry only a summary — one assistant message per turn, no streamed text.
 * The full dialogue lives in the session's Claude project transcript
 * (`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`), so when one exists it
 * is the authoritative source and the
 * hook-derived view is the fallback. This parses that transcript into the same
 * `ConversationItem` shape the hook path produces, so the UI renders them
 * identically.
 *
 * Pure and line-oriented: the caller reads the file (or streams it) and hands the
 * lines in. A blank or malformed line is skipped, never fatal.
 */

import type { ConversationItem } from './conversation.js';

interface ContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : typeof (b as ContentBlock)?.text === 'string' ? (b as ContentBlock).text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function parseTranscriptToConversation(lines: readonly string[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  /** Open tool calls by tool_use id, so a tool_result completes them in place. */
  const openTools = new Map<string, ConversationItem>();
  let seq = 0;
  const nextId = () => `t${seq++}`;

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: { type?: string; message?: { role?: string; content?: unknown }; timestamp?: string };
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // A single bad line must not lose the rest of the transcript.
    }

    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    const occurredAt = entry.timestamp ? Date.parse(entry.timestamp) || 0 : 0;

    // A plain string is a user prompt (or, rarely, an assistant string).
    if (typeof content === 'string') {
      if (content.trim()) {
        items.push({
          itemId: nextId(),
          kind: entry.type === 'assistant' ? 'assistant' : 'user',
          occurredAt,
          confidence: 'exact',
          text: content,
        });
      }
      continue;
    }
    if (!Array.isArray(content)) continue;

    const textParts: string[] = [];
    for (const raw of content) {
      const block = raw as ContentBlock;
      switch (block.type) {
        case 'text':
          if (typeof block.text === 'string' && block.text.trim()) textParts.push(block.text);
          break;

        case 'tool_use': {
          // Flush any pending text first so ordering (text → tool) is preserved.
          if (textParts.length > 0) {
            items.push({
              itemId: nextId(),
              kind: 'assistant',
              occurredAt,
              confidence: 'exact',
              text: textParts.join('\n\n'),
            });
            textParts.length = 0;
          }
          const item: ConversationItem = {
            itemId: block.id ?? nextId(),
            kind: 'tool-call',
            occurredAt,
            confidence: 'exact',
            toolName: block.name,
            toolUseId: block.id,
            status: 'running',
          };
          items.push(item);
          if (block.id) openTools.set(block.id, item);
          break;
        }

        case 'tool_result': {
          const id = block.tool_use_id;
          const open = id ? openTools.get(id) : undefined;
          const status = block.is_error ? 'failed' : 'completed';
          const detail = blockText(block.content) || undefined;
          if (open) {
            open.status = status;
            if (detail) open.detail = detail;
            if (id) openTools.delete(id);
          } else {
            // Orphan result (transcript truncated mid-turn): show it, don't hide it.
            items.push({
              itemId: nextId(),
              kind: 'tool-call',
              occurredAt,
              confidence: 'exact',
              toolUseId: id,
              status,
              detail,
            });
          }
          break;
        }

        default:
          break; // thinking / image / other blocks are not dialogue text here.
      }
    }

    if (textParts.length > 0) {
      items.push({
        itemId: nextId(),
        kind: entry.type === 'assistant' ? 'assistant' : 'user',
        occurredAt,
        confidence: 'exact',
        text: textParts.join('\n\n'),
      });
    }
  }

  return items;
}

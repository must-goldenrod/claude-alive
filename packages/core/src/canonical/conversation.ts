/**
 * Conversation read model (spec §F.7).
 *
 * Projects canonical events into the dialogue a user actually wants to read when
 * they click a session: prompts, assistant replies, tool calls, approvals. This
 * is deliberately *not* terminal scrollback — raw output is a separate surface.
 *
 * Two rules from the spec shape this:
 *  - **Do not invent dialogue.** State churn (`agent.state`) and metering
 *    (`usage.updated`) are not conversation and are dropped rather than
 *    rendered as pseudo-messages.
 *  - **Do not hide gaps.** A completion with no preceding start still produces an
 *    item, so a hole in the log is visible instead of silently swallowed.
 *
 * Completeness caveat for Claude: hooks do not stream assistant text. The only
 * assistant content available is `last_assistant_message` on Stop, so a
 * hook-derived conversation shows one assistant item per turn, not the full
 * streamed reply. Reading the JSONL transcript (§F.7 "1순위") is what fills that
 * in; callers should surface `completeness` rather than implying it is whole.
 */

import type { CanonicalEvent } from './events.js';
import type { ConversationItemKind } from './domain.js';
import type { StateConfidence } from './state.js';

export type ConversationItemStatus = 'running' | 'completed' | 'failed';

export interface ConversationItem {
  /** Stable id — the canonical event that introduced this item. */
  itemId: string;
  kind: ConversationItemKind;
  occurredAt: number;
  confidence: StateConfidence;
  text?: string;
  toolName?: string;
  toolUseId?: string;
  approvalId?: string;
  decision?: string;
  status?: ConversationItemStatus;
  /** Failure reason or other supporting detail. */
  detail?: string;
}

function str(event: CanonicalEvent, key: string): string | undefined {
  const p = event.payload as Record<string, unknown>;
  return typeof p?.[key] === 'string' ? (p[key] as string) : undefined;
}

function base(event: CanonicalEvent, kind: ConversationItemKind): ConversationItem {
  return {
    itemId: event.eventId,
    kind,
    occurredAt: event.occurredAt,
    confidence: event.confidence,
  };
}

export function buildConversation(events: readonly CanonicalEvent[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  /** Open tool calls and approvals, so a later event updates rather than appends. */
  const openByKey = new Map<string, ConversationItem>();

  for (const event of events) {
    switch (event.kind) {
      case 'message.user': {
        const text = str(event, 'text');
        if (text) items.push({ ...base(event, 'user'), text });
        break;
      }

      case 'message.assistant': {
        const text = str(event, 'text');
        if (text) items.push({ ...base(event, 'assistant'), text });
        break;
      }

      case 'message.reasoning': {
        const text = str(event, 'text');
        if (text) items.push({ ...base(event, 'reasoning'), text });
        break;
      }

      case 'run.completed': {
        // The turn's assistant reply rides on the completion event for Claude.
        const text = str(event, 'lastAssistantMessage');
        if (text) items.push({ ...base(event, 'assistant'), text });
        break;
      }

      case 'tool.started': {
        const toolUseId = str(event, 'toolUseId');
        const item: ConversationItem = {
          ...base(event, 'tool-call'),
          toolName: str(event, 'toolName'),
          toolUseId,
          status: 'running',
        };
        items.push(item);
        if (toolUseId) openByKey.set(`tool:${toolUseId}`, item);
        break;
      }

      case 'tool.completed':
      case 'tool.failed': {
        const toolUseId = str(event, 'toolUseId');
        const status: ConversationItemStatus = event.kind === 'tool.failed' ? 'failed' : 'completed';
        const open = toolUseId ? openByKey.get(`tool:${toolUseId}`) : undefined;
        if (open) {
          open.status = status;
          const reason = str(event, 'reason');
          if (reason) open.detail = reason;
          if (toolUseId) openByKey.delete(`tool:${toolUseId}`);
        } else {
          // No matching start: surface it so the gap is visible.
          items.push({
            ...base(event, 'tool-call'),
            toolName: str(event, 'toolName'),
            toolUseId,
            status,
            detail: str(event, 'reason'),
          });
        }
        break;
      }

      case 'approval.requested': {
        const approvalId = str(event, 'approvalId');
        const item: ConversationItem = {
          ...base(event, 'approval'),
          approvalId,
          toolName: str(event, 'toolName'),
          detail: str(event, 'reason'),
          status: 'running',
        };
        items.push(item);
        if (approvalId) openByKey.set(`approval:${approvalId}`, item);
        break;
      }

      case 'approval.decided': {
        const approvalId = str(event, 'approvalId');
        const open = approvalId ? openByKey.get(`approval:${approvalId}`) : undefined;
        const decision = str(event, 'decision');
        if (open) {
          open.status = 'completed';
          if (decision) open.decision = decision;
          if (approvalId) openByKey.delete(`approval:${approvalId}`);
        } else {
          items.push({ ...base(event, 'approval'), approvalId, decision, status: 'completed' });
        }
        break;
      }

      case 'session.created':
      case 'session.ended':
      case 'run.failed':
      case 'artifact.created':
        items.push({ ...base(event, 'system-event'), detail: event.kind });
        break;

      default:
        // agent.state, usage.updated, connection.* and friends are not dialogue.
        break;
    }
  }

  return items;
}

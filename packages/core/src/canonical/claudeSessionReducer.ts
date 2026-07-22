/**
 * Stateful Claude hook → canonical stream (spec §I.2, §H.3).
 *
 * `claudeHookToCanonical` is deliberately stateless, so it can map a hook to
 * content events but cannot know the session's state — that needs history. This
 * layer holds the per-session FSM position and appends an authoritative
 * `agent.state` event after the content events, so a provider-neutral projection
 * never has to encode Claude's state semantics.
 *
 * It reuses the shipped `transition()` FSM rather than reimplementing it, which
 * is what keeps v2 state identical to what v1 users already see.
 */

import type { AgentState, HookEventName, HookEventPayload } from '../events/types.js';
import { transition } from '../state/agentFSM.js';
import { extractToolDisplayName } from '../events/toolMapper.js';
import type { CanonicalEvent } from './events.js';
import {
  claudeHookToCanonical,
  permissionRequestFromNotification,
  type ClaudeHookContext,
} from './claudeV1ToV2.js';
import { normalizeLegacyState } from './stateMapping.js';

interface SessionState {
  state: AgentState;
  currentTool: string | null;
}

export class ClaudeCanonicalStream {
  private readonly sessions = new Map<string, SessionState>();

  /**
   * Convert one hook into canonical events: the content events from the
   * stateless mapper, followed by the authoritative `agent.state`.
   */
  push(payload: HookEventPayload, ctx: ClaudeHookContext): CanonicalEvent[] {
    const events = claudeHookToCanonical(payload, ctx);
    const stateEvent = this.advance(payload, ctx);
    return stateEvent ? [...events, stateEvent] : events;
  }

  private advance(payload: HookEventPayload, ctx: ClaudeHookContext): CanonicalEvent | null {
    const { event, data } = payload;
    const key = ctx.sessionId;

    if (event === 'SessionStart') {
      this.sessions.set(key, { state: 'spawning', currentTool: null });
      return this.stateEvent(payload, ctx, this.sessions.get(key)!);
    }

    // Sessions that predate the server are auto-created, as SessionStore does.
    const current = this.sessions.get(key) ?? { state: 'spawning', currentTool: null };

    let toolName = data.tool_name ?? undefined;
    let effectiveEvent: HookEventName = event;
    if (event === 'Notification') {
      const { isPermission, tool } = permissionRequestFromNotification(data.message ?? '');
      if (isPermission) {
        effectiveEvent = 'PermissionRequest';
        if (!toolName && tool) toolName = tool;
      }
    }

    const result = transition(current.state, effectiveEvent, toolName);
    const next: SessionState = {
      state: result.newState,
      currentTool: result.toolName ? extractToolDisplayName(result.toolName) : null,
    };
    this.sessions.set(key, next);
    return this.stateEvent(payload, ctx, next);
  }

  private stateEvent(payload: HookEventPayload, ctx: ClaudeHookContext, s: SessionState): CanonicalEvent {
    const normalized = normalizeLegacyState(s.state, s.currentTool);
    return {
      schemaVersion: 2,
      eventId: ctx.newEventId(),
      kind: 'agent.state',
      provider: 'claude',
      source: 'hook',
      // Distinct per hook so state events are never deduped against each other.
      sourceEventId: `state:${payload.event}:${payload.timestamp}`,
      workspaceId: ctx.workspaceId,
      sessionId: ctx.sessionId,
      occurredAt: payload.timestamp,
      receivedAt: ctx.receivedAt,
      confidence: normalized.confidence,
      payload: {
        common: normalized.common,
        providerState: normalized.providerState,
        currentTool: s.currentTool ?? undefined,
        reason: normalized.reason,
      },
    };
  }
}

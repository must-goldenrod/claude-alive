/**
 * Claude v1 hook → v2 canonical event converter (spec §H.3, §J.3).
 *
 * The existing 17 Claude hooks stay as the ingress; this pure function maps each
 * hook into zero or more canonical events. Ambiguous hooks map to `agent.state`
 * with `confidence: 'heuristic'` (never presented as fact), and hooks with no
 * clean canonical meaning yet (worktree lifecycle, todo-level completion) map to
 * nothing rather than being force-fit — the raw hook is still persisted upstream.
 *
 * Deferred by design (a stateless per-hook mapper cannot own these):
 * - Dedupe fallback for events with no native id: §I.4 prescribes a content-hash
 *   + `dedupeConfidence`; that lives in the storage/dedupe layer (CP3), not here.
 * - Run correlation (`run.started`, `runId` on `run.completed`): needs cross-hook
 *   session state, so it belongs to the stateful adapter layer (CP4/P1).
 */

import type { HookEventName, HookEventPayload } from '../events/types.js';
import type { CanonicalEvent, CanonicalEventKind } from './events.js';
import type { StateConfidence } from './state.js';

export interface ClaudeHookContext {
  /** Alive stable session id this hook belongs to. */
  sessionId: string;
  workspaceId: string;
  /** Wall-clock at ingestion. */
  receivedAt: number;
  /** ULID factory (injected so callers control id generation). */
  newEventId: () => string;
}

interface Mapping {
  kind: CanonicalEventKind;
  confidence: StateConfidence;
  payload: (data: HookEventPayload['data'], ctx: ClaudeHookContext) => Record<string, unknown>;
  /** Provider-native id for dedupe, when the hook carries one. */
  sourceEventId?: (data: HookEventPayload['data']) => string | undefined;
  agentId?: (data: HookEventPayload['data']) => string | undefined;
}

/**
 * Claude Code's `Notification` hook is overloaded: it fires both for decision
 * requests ("needs your permission to use X"), which block the user, and for
 * plain idle reminders, which do not. The distinction is a pure function of the
 * message, so it belongs here rather than in a stateful layer.
 */
export function permissionRequestFromNotification(
  message: string,
): { isPermission: boolean; tool?: string } {
  const m =
    message.match(/permission to use ([A-Za-z][\w-]*)/i) ??
    message.match(/needs your (?:permission|approval|confirmation)(?: to use ([A-Za-z][\w-]*))?/i);
  return m ? { isPermission: true, tool: m[1] } : { isPermission: false };
}

/** Phase-qualify a tool_use_id so lifecycle phases don't share a dedupe key. */
function toolEventId(toolUseId: string | undefined, phase: string): string | undefined {
  return toolUseId ? `${toolUseId}:${phase}` : undefined;
}

const MAPPINGS: Partial<Record<HookEventName, Mapping>> = {
  SessionStart: {
    kind: 'session.created',
    confidence: 'exact',
    payload: (d) => ({ cwd: d.cwd, source: d.source }),
  },
  SessionEnd: {
    kind: 'session.ended',
    confidence: 'exact',
    payload: (d) => ({ reason: d.reason }),
  },
  UserPromptSubmit: {
    kind: 'message.user',
    confidence: 'exact',
    payload: (d) => ({ text: d.prompt ?? '' }),
  },
  PreToolUse: {
    kind: 'tool.started',
    confidence: 'exact',
    // Phase-qualified so tool.started/completed/failed of one tool_use_id keep
    // distinct dedupe keys — the spec dedupe key (§I.4) excludes `kind`.
    sourceEventId: (d) => toolEventId(d.tool_use_id, 'started'),
    payload: (d) => ({ toolName: d.tool_name, toolUseId: d.tool_use_id, input: d.tool_input }),
  },
  PostToolUse: {
    kind: 'tool.completed',
    confidence: 'exact',
    sourceEventId: (d) => toolEventId(d.tool_use_id, 'completed'),
    payload: (d) => ({ toolName: d.tool_name, toolUseId: d.tool_use_id, response: d.tool_response }),
  },
  PostToolUseFailure: {
    kind: 'tool.failed',
    confidence: 'exact',
    sourceEventId: (d) => toolEventId(d.tool_use_id, 'failed'),
    payload: (d) => ({ toolName: d.tool_name, toolUseId: d.tool_use_id, reason: d.reason }),
  },
  PermissionRequest: {
    kind: 'approval.requested',
    confidence: 'exact',
    payload: (d) => ({ toolName: d.tool_name, reason: d.reason }),
  },
  Stop: {
    kind: 'run.completed',
    confidence: 'exact',
    payload: (d) => ({ lastAssistantMessage: d.last_assistant_message }),
  },
  SubagentStart: {
    kind: 'agent.spawned',
    confidence: 'exact',
    agentId: (d) => d.agent_id,
    payload: (d, ctx) => ({ agentType: d.agent_type, agentId: d.agent_id, parentSessionId: ctx.sessionId }),
  },
  SubagentStop: {
    kind: 'agent.despawned',
    confidence: 'exact',
    agentId: (d) => d.agent_id,
    payload: (d) => ({ agentId: d.agent_id }),
  },
  // Notification is handled separately: it is overloaded and only its
  // permission-request form carries canonical meaning (see below).
  // TeammateIdle carries no content event; session state is owned by the
  // stateful Claude layer, which runs the FSM.
  ConfigChange: {
    kind: 'session.updated',
    confidence: 'derived',
    payload: (d) => ({ reason: d.reason ?? 'config-change', message: d.message }),
  },
  PreCompact: {
    kind: 'session.updated',
    confidence: 'derived',
    payload: (d) => ({ reason: d.reason ?? 'pre-compact', message: d.message }),
  },
  // Intentionally unmapped for CP2 (raw hook is still persisted upstream):
  // TaskCompleted, WorktreeCreate, WorktreeRemove.
};

export function claudeHookToCanonical(
  payload: HookEventPayload,
  ctx: ClaudeHookContext,
): CanonicalEvent[] {
  const data = payload.data;

  // Overloaded hook: only its decision-request form is a canonical event.
  if (payload.event === 'Notification') {
    const { isPermission, tool } = permissionRequestFromNotification(data.message ?? '');
    if (!isPermission) return [];
    return [
      buildEvent(payload, ctx, {
        kind: 'approval.requested',
        confidence: 'derived',
        payload: () => ({ toolName: data.tool_name ?? tool, reason: data.message }),
      }),
    ];
  }

  const mapping = MAPPINGS[payload.event];
  if (!mapping) return [];
  return [buildEvent(payload, ctx, mapping)];
}

function buildEvent(payload: HookEventPayload, ctx: ClaudeHookContext, mapping: Mapping): CanonicalEvent {
  const data = payload.data;
  // Guard against missing/invalid hook timestamps (ingress zod allows any number).
  const occurredAt =
    Number.isFinite(payload.timestamp) && payload.timestamp > 0 ? payload.timestamp : ctx.receivedAt;
  return {
    schemaVersion: 2,
    eventId: ctx.newEventId(),
    kind: mapping.kind,
    provider: 'claude',
    source: 'hook',
    sourceEventId: mapping.sourceEventId?.(data),
    workspaceId: ctx.workspaceId,
    sessionId: ctx.sessionId,
    agentId: mapping.agentId?.(data),
    occurredAt,
    receivedAt: ctx.receivedAt,
    confidence: mapping.confidence,
    // transcript_path rides on every hook; carrying it through is what lets a
    // projection know a structured transcript exists rather than assuming it.
    payload: data.transcript_path
      ? { ...mapping.payload(data, ctx), transcriptPath: data.transcript_path }
      : mapping.payload(data, ctx),
  };
}

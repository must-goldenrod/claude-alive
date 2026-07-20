/**
 * Codex app-server → canonical event mapping (spec §H.3, ADR-0004).
 *
 * Verified against `codex app-server generate-json-schema` from **codex-cli
 * 0.144.6**: method names come from `ServerNotification`/`ServerRequest`, and the
 * parameter shapes from the generated definitions. An earlier version of this
 * file was written from assumed shapes and was wrong in three ways — there is no
 * `turn/failed` notification, turn events carry a `Turn` object rather than a
 * `turnId`, and `thread/started` carries a whole `Thread`. Re-run the generator
 * and re-check this table when targeting a different Codex version.
 *
 * Unknown methods and unknown item types map to nothing on purpose: inventing a
 * canonical meaning for a shape we have not seen would put a guess into the log
 * with `exact` confidence, which is worse than a gap.
 */

import type { CanonicalEvent, CanonicalEventKind } from './events.js';
import type { CommonAgentState } from './state.js';

export interface CodexServerMessage {
  method: string;
  params?: Record<string, unknown>;
}

export interface CodexEventContext {
  /** Alive stable session id this thread maps to. */
  sessionId: string;
  workspaceId: string;
  receivedAt: number;
  newEventId: () => string;
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
function str(source: Record<string, unknown>, key: string): string | undefined {
  return typeof source[key] === 'string' ? (source[key] as string) : undefined;
}
function num(source: Record<string, unknown>, key: string): number | undefined {
  return typeof source[key] === 'number' ? (source[key] as number) : undefined;
}

/** ThreadItem types Alive represents as tool calls. */
const TOOL_ITEM_TYPES = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'dynamicToolCall']);

/** `ThreadStatus.type` → canonical state. */
const THREAD_STATUS: Record<string, CommonAgentState> = {
  notLoaded: 'unknown',
  idle: 'ready',
  active: 'thinking',
  systemError: 'failed',
};

/** `TurnStatus` values that are not a successful completion. */
const TURN_FAILURE = new Set(['failed', 'interrupted']);

function build(
  ctx: CodexEventContext,
  kind: CanonicalEventKind,
  payload: Record<string, unknown>,
  extra: Partial<CanonicalEvent> = {},
): CanonicalEvent {
  return {
    schemaVersion: 2,
    eventId: ctx.newEventId(),
    kind,
    provider: 'codex',
    source: 'structured',
    workspaceId: ctx.workspaceId,
    sessionId: ctx.sessionId,
    occurredAt: ctx.receivedAt,
    receivedAt: ctx.receivedAt,
    // A structured feed reports facts; nothing here is inferred from output.
    confidence: 'exact',
    payload,
    ...extra,
  };
}

function mapItem(
  ctx: CodexEventContext,
  params: Record<string, unknown>,
  phase: 'started' | 'completed',
): CanonicalEvent[] {
  const item = obj(params.item);
  const type = str(item, 'type');
  if (!type) return [];

  const id = str(item, 'id');
  const runId = str(params, 'turnId');
  const occurredAt = num(params, 'startedAtMs') ?? ctx.receivedAt;
  const common: Partial<CanonicalEvent> = { occurredAt, ...(runId ? { runId } : {}) };

  if (TOOL_ITEM_TYPES.has(type)) {
    // `status` is authoritative; exitCode is a commandExecution detail that is
    // absent for other tool kinds.
    const status = str(item, 'status');
    const exitCode = num(item, 'exitCode');
    const failed =
      phase === 'completed' && (status === 'failed' || (status === undefined && exitCode !== undefined && exitCode !== 0));
    const kind: CanonicalEventKind = phase === 'started' ? 'tool.started' : failed ? 'tool.failed' : 'tool.completed';
    const suffix = phase === 'started' ? 'started' : failed ? 'failed' : 'completed';
    return [
      build(
        ctx,
        kind,
        { toolName: type, toolUseId: id, command: str(item, 'command'), exitCode, status },
        // Phase-qualified so a lifecycle's start and end keep distinct dedupe keys.
        { ...common, ...(id ? { sourceEventId: `${id}:${suffix}` } : {}) },
      ),
    ];
  }

  // Text items only carry meaning once complete; a `started` marker adds nothing.
  if (phase !== 'completed') return [];

  if (type === 'userMessage') {
    const text = str(item, 'content');
    return text ? [build(ctx, 'message.user', { text }, { ...common, ...(id ? { sourceEventId: `${id}:user` } : {}) })] : [];
  }
  if (type === 'agentMessage') {
    const text = str(item, 'text');
    return text
      ? [build(ctx, 'message.assistant', { text }, { ...common, ...(id ? { sourceEventId: `${id}:assistant` } : {}) })]
      : [];
  }
  if (type === 'reasoning') {
    const text = str(item, 'text');
    return text
      ? [build(ctx, 'message.reasoning', { text }, { ...common, ...(id ? { sourceEventId: `${id}:reasoning` } : {}) })]
      : [];
  }

  return [];
}

export function codexEventToCanonical(
  message: CodexServerMessage,
  ctx: CodexEventContext,
): CanonicalEvent[] {
  const params = obj(message.params);

  switch (message.method) {
    case 'thread/started': {
      const thread = obj(params.thread);
      return [build(ctx, 'session.created', { cwd: str(thread, 'cwd'), threadId: str(thread, 'id') })];
    }

    case 'thread/status/changed': {
      const type = str(obj(params.status), 'type') ?? 'notLoaded';
      return [
        build(ctx, 'agent.state', {
          common: THREAD_STATUS[type] ?? 'unknown',
          providerState: type,
        }),
      ];
    }

    case 'turn/started': {
      const turn = obj(params.turn);
      return [build(ctx, 'run.started', {}, { runId: str(turn, 'id') })];
    }

    case 'turn/completed': {
      // There is no `turn/failed`: a failed or interrupted turn arrives here with
      // a non-success `status`, and reading it as a completion would report a
      // failure as success.
      const turn = obj(params.turn);
      const status = str(turn, 'status');
      const failed = status !== undefined && TURN_FAILURE.has(status);
      return [
        build(
          ctx,
          failed ? 'run.failed' : 'run.completed',
          failed ? { reason: str(obj(turn.error), 'message'), status } : { status },
          { runId: str(turn, 'id') },
        ),
      ];
    }

    case 'error': {
      // A retryable error is not terminal: recording it as `run.failed` would end
      // a run the provider intends to continue.
      const willRetry = params.willRetry === true;
      const reason = str(obj(params.error), 'message');
      const runId = str(params, 'turnId');
      return [
        willRetry
          ? build(
              ctx,
              'agent.state',
              { common: 'thinking' satisfies CommonAgentState, providerState: 'error', reason, willRetry },
              runId ? { runId } : {},
            )
          : build(ctx, 'run.failed', { reason, willRetry }, runId ? { runId } : {}),
      ];
    }

    case 'item/started':
      return mapItem(ctx, params, 'started');

    case 'item/completed':
      return mapItem(ctx, params, 'completed');

    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
    case 'item/permissions/requestApproval': {
      const approvalId = str(params, 'callId') ?? str(params, 'id');
      return [
        build(
          ctx,
          'approval.requested',
          {
            approvalId,
            toolName: message.method.split('/')[1],
            command: str(params, 'command'),
            path: str(params, 'path'),
          },
          approvalId ? { sourceEventId: `${approvalId}:approval` } : {},
        ),
      ];
    }

    case 'thread/tokenUsage/updated':
      return [build(ctx, 'usage.updated', { ...obj(params.usage) })];

    default:
      // Includes every `*/delta` stream: rendering concerns, not log entries.
      return [];
  }
}

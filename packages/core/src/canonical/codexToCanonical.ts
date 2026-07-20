/**
 * Codex app-server → canonical event mapping (spec §H.3, ADR-0004).
 *
 * Codex speaks JSON-RPC over stdio and reports structured items (agent messages,
 * reasoning, command executions, file changes) plus turn lifecycle, token usage
 * and server-initiated approval requests. Unlike the Claude hook path this is a
 * genuine structured feed, so events map with `source: 'structured'` and
 * `confidence: 'exact'` — nothing here is inferred from screen output.
 *
 * **Verification status:** built against the documented app-server protocol and
 * exercised by recorded fixtures (§R.1). It has NOT been smoke-tested against an
 * installed Codex on this machine. Method names and item shapes must be
 * re-confirmed against `codex app-server generate-json-schema` for the target
 * version before ADR-0004 moves from Conditionally Accepted to Accepted.
 *
 * Unknown methods and unknown item types deliberately map to nothing: inventing
 * a canonical meaning for a shape we have not seen would put a guess into the
 * log with `exact` confidence, which is worse than a gap.
 */

import type { CanonicalEvent, CanonicalEventKind } from './events.js';

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

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  path?: string;
  exitCode?: number;
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function str(source: Record<string, unknown>, key: string): string | undefined {
  return typeof source[key] === 'string' ? (source[key] as string) : undefined;
}

/** Item types Codex reports that Alive represents as tool calls. */
const TOOL_ITEM_TYPES = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch']);

function build(
  ctx: CodexEventContext,
  kind: CanonicalEventKind,
  payload: Record<string, unknown>,
  extra: Partial<CanonicalEvent> = {},
): CanonicalEvent {
  const now = ctx.receivedAt;
  return {
    schemaVersion: 2,
    eventId: ctx.newEventId(),
    kind,
    provider: 'codex',
    source: 'structured',
    workspaceId: ctx.workspaceId,
    sessionId: ctx.sessionId,
    occurredAt: now,
    receivedAt: now,
    // A structured feed reports facts; nothing here is inferred.
    confidence: 'exact',
    payload,
    ...extra,
  };
}

function mapItem(
  ctx: CodexEventContext,
  item: CodexItem,
  phase: 'started' | 'completed',
): CanonicalEvent[] {
  const type = item.type;
  if (!type) return [];

  if (TOOL_ITEM_TYPES.has(type)) {
    const failed = phase === 'completed' && typeof item.exitCode === 'number' && item.exitCode !== 0;
    const kind: CanonicalEventKind =
      phase === 'started' ? 'tool.started' : failed ? 'tool.failed' : 'tool.completed';
    const suffix = phase === 'started' ? 'started' : failed ? 'failed' : 'completed';
    return [
      build(
        ctx,
        kind,
        {
          toolName: type,
          toolUseId: item.id,
          command: item.command,
          path: item.path,
          exitCode: item.exitCode,
        },
        // Phase-qualified so a lifecycle's start and end keep distinct dedupe keys.
        item.id ? { sourceEventId: `${item.id}:${suffix}` } : {},
      ),
    ];
  }

  // Text items only carry meaning once complete; a `started` marker adds nothing.
  if (phase !== 'completed') return [];

  if (type === 'agentMessage' && item.text) {
    return [build(ctx, 'message.assistant', { text: item.text }, item.id ? { sourceEventId: `${item.id}:message` } : {})];
  }
  if (type === 'reasoning' && item.text) {
    return [build(ctx, 'message.reasoning', { text: item.text }, item.id ? { sourceEventId: `${item.id}:reasoning` } : {})];
  }

  return [];
}

export function codexEventToCanonical(
  message: CodexServerMessage,
  ctx: CodexEventContext,
): CanonicalEvent[] {
  const params = obj(message.params);

  switch (message.method) {
    case 'thread/started':
      return [build(ctx, 'session.created', { cwd: str(params, 'cwd'), threadId: str(params, 'threadId') })];

    case 'turn/started':
      return [build(ctx, 'run.started', {}, { runId: str(params, 'turnId') })];

    case 'turn/completed':
      return [build(ctx, 'run.completed', {}, { runId: str(params, 'turnId') })];

    case 'turn/failed':
      return [
        build(ctx, 'run.failed', { reason: str(obj(params.error), 'message') }, { runId: str(params, 'turnId') }),
      ];

    case 'item/started':
      return mapItem(ctx, obj(params.item) as CodexItem, 'started');

    case 'item/completed':
      return mapItem(ctx, obj(params.item) as CodexItem, 'completed');

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
      // Unknown method: record nothing rather than guess a canonical meaning.
      return [];
  }
}

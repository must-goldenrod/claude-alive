/**
 * `sessions_current` read model (spec §K.2).
 *
 * A pure, immutable reducer over canonical events. Projections must be
 * rebuildable from the event log alone, so this holds no I/O and no clock —
 * replaying the same events always yields the same state.
 */

import type { CanonicalEvent } from './events.js';
import type { CommonAgentState, StateConfidence } from './state.js';
import type { ProviderId } from './capabilities.js';

export interface SessionProjectionRow {
  sessionId: string;
  provider: ProviderId;
  workspaceId: string;
  state: CommonAgentState;
  stateConfidence: StateConfidence;
  cwd?: string;
  transcriptPath?: string;
  lastPrompt?: string;
  currentTool?: string;
  toolsUsed: string[];
  toolCallCount: number;
  totalEvents: number;
  pendingApprovals: number;
  lastEventAt: number;
  subagentIds: string[];
}

export interface ProjectionState {
  sessions: Record<string, SessionProjectionRow>;
}

export function emptyProjection(): ProjectionState {
  return { sessions: {} };
}

function blankRow(event: CanonicalEvent): SessionProjectionRow {
  return {
    sessionId: event.sessionId,
    provider: event.provider,
    workspaceId: event.workspaceId,
    state: 'starting',
    stateConfidence: 'derived',
    toolsUsed: [],
    toolCallCount: 0,
    totalEvents: 0,
    pendingApprovals: 0,
    lastEventAt: event.occurredAt,
    subagentIds: [],
  };
}

function payloadString(event: CanonicalEvent, key: string): string | undefined {
  const p = event.payload as Record<string, unknown>;
  return typeof p?.[key] === 'string' ? (p[key] as string) : undefined;
}

/** Returns the next state for kinds that imply one, or undefined to leave it. */
function stateFor(event: CanonicalEvent): { state: CommonAgentState; confidence: StateConfidence } | undefined {
  switch (event.kind) {
    case 'session.created':
      return { state: 'starting', confidence: 'exact' };
    case 'message.user':
    case 'message.assistant':
    case 'tool.completed':
    case 'tool.failed':
      return { state: 'thinking', confidence: 'derived' };
    case 'tool.started':
      return { state: 'using-tool', confidence: 'exact' };
    case 'approval.requested':
      return { state: 'waiting-user', confidence: 'exact' };
    case 'run.completed':
      return { state: 'completed', confidence: 'exact' };
    case 'run.failed':
      return { state: 'failed', confidence: 'exact' };
    case 'session.ended':
      return { state: 'stopped', confidence: 'exact' };
    case 'agent.state': {
      // The adapter told us the state directly; trust its own confidence.
      const common = payloadString(event, 'common') as CommonAgentState | undefined;
      return common ? { state: common, confidence: event.confidence } : undefined;
    }
    default:
      return undefined;
  }
}

export function applyCanonicalEvent(state: ProjectionState, event: CanonicalEvent): ProjectionState {
  const prev = state.sessions[event.sessionId] ?? blankRow(event);
  const next: SessionProjectionRow = {
    ...prev,
    toolsUsed: [...prev.toolsUsed],
    subagentIds: [...prev.subagentIds],
    totalEvents: prev.totalEvents + 1,
    lastEventAt: Math.max(prev.lastEventAt, event.occurredAt),
  };

  const cwd = payloadString(event, 'cwd');
  if (cwd) next.cwd = cwd;
  const transcriptPath = payloadString(event, 'transcriptPath');
  if (transcriptPath) next.transcriptPath = transcriptPath;

  const derived = stateFor(event);
  if (derived) {
    next.state = derived.state;
    next.stateConfidence = derived.confidence;
  }

  switch (event.kind) {
    case 'message.user': {
      const text = payloadString(event, 'text');
      if (text) next.lastPrompt = text;
      break;
    }
    case 'tool.started': {
      const tool = payloadString(event, 'toolName');
      // Only a tool *start* is a call; completion/failure report the same call.
      next.toolCallCount += 1;
      if (tool) {
        next.currentTool = tool;
        if (!next.toolsUsed.includes(tool)) next.toolsUsed.push(tool);
      }
      break;
    }
    case 'tool.completed':
    case 'tool.failed': {
      const tool = payloadString(event, 'toolName');
      if (tool && !next.toolsUsed.includes(tool)) next.toolsUsed.push(tool);
      // Neutral default: the call is over. An adapter that keeps its own notion
      // of a running tool restates it in the `agent.state` event that follows.
      next.currentTool = undefined;
      break;
    }
    case 'approval.requested': {
      const tool = payloadString(event, 'toolName');
      if (tool && !next.toolsUsed.includes(tool)) next.toolsUsed.push(tool);
      next.pendingApprovals += 1;
      break;
    }
    case 'agent.state': {
      // An adapter that owns its state semantics also owns the running tool;
      // absence means "no tool in flight", so it clears rather than persists.
      next.currentTool = payloadString(event, 'currentTool');
      break;
    }
    case 'approval.decided':
      next.pendingApprovals = Math.max(0, next.pendingApprovals - 1);
      break;
    case 'agent.spawned':
      if (event.agentId && !next.subagentIds.includes(event.agentId)) next.subagentIds.push(event.agentId);
      break;
    case 'agent.despawned':
      if (event.agentId) next.subagentIds = next.subagentIds.filter((id) => id !== event.agentId);
      break;
    default:
      break;
  }

  return { sessions: { ...state.sessions, [event.sessionId]: next } };
}

export function buildProjection(events: readonly CanonicalEvent[]): ProjectionState {
  return events.reduce<ProjectionState>(applyCanonicalEvent, emptyProjection());
}

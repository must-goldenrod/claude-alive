import type { AgentState, HookEventName, ToolAnimation } from '../events/types.js';
import { toolToAnimation } from '../events/toolMapper.js';

export interface FSMTransitionResult {
  newState: AgentState;
  toolAnimation: ToolAnimation | null;
  toolName: string | null;
}

const TRANSITIONS: Record<AgentState, Partial<Record<HookEventName, AgentState>>> = {
  spawning: {
    UserPromptSubmit: 'listening',
    PreToolUse: 'active',
    Stop: 'idle',
    SessionEnd: 'despawning',
  },
  idle: {
    UserPromptSubmit: 'listening',
    PreToolUse: 'active',
    PermissionRequest: 'waiting',
    SessionEnd: 'despawning',
    Notification: 'idle',
    TaskCompleted: 'done',
  },
  listening: {
    PreToolUse: 'active',
    PermissionRequest: 'waiting',
    Stop: 'idle',
    SessionEnd: 'despawning',
    TaskCompleted: 'done',
  },
  active: {
    PostToolUse: 'active',
    PostToolUseFailure: 'error',
    PreToolUse: 'active',
    PermissionRequest: 'waiting',
    Stop: 'idle',
    SessionEnd: 'despawning',
    SubagentStart: 'active',
    SubagentStop: 'active',
    TaskCompleted: 'done',
  },
  waiting: {
    // Sticky question state: once Claude asks the user for anything
    // (permission, input, decision), the UI stays amber until the user
    // explicitly responds with a new prompt or the session ends.
    // Crucially this does NOT exit on PreToolUse/PostToolUse — those
    // can fire moments after permission is granted, and exiting there
    // would make the question flash by too fast to notice. The user
    // chose this trade-off explicitly: keep the question marker
    // visible until they prompt again, then overwrite from there.
    UserPromptSubmit: 'listening',
    Stop: 'idle',
    SessionEnd: 'despawning',
    Notification: 'waiting',
    TaskCompleted: 'done',
  },
  error: {
    PreToolUse: 'active',
    UserPromptSubmit: 'listening',
    PermissionRequest: 'waiting',
    Stop: 'idle',
    SessionEnd: 'despawning',
    TaskCompleted: 'done',
  },
  done: {
    UserPromptSubmit: 'listening',
    PreToolUse: 'active',
    PermissionRequest: 'waiting',
    SessionEnd: 'despawning',
  },
  despawning: {},
  removed: {},
};

export function transition(
  currentState: AgentState,
  event: HookEventName,
  toolName?: string,
): FSMTransitionResult {
  const stateTransitions = TRANSITIONS[currentState];
  const newState = stateTransitions?.[event] ?? currentState;
  const toolAnimation = (newState === 'active' && toolName)
    ? toolToAnimation(toolName)
    : null;
  return { newState, toolAnimation, toolName: toolName ?? null };
}

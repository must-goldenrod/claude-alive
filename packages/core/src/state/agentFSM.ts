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
    PreToolUse: 'active',
    PostToolUse: 'active',
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

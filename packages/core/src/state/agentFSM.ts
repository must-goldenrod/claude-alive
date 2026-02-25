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
    SessionEnd: 'despawning',
    Notification: 'idle',
  },
  listening: {
    PreToolUse: 'active',
    Stop: 'idle',
    SessionEnd: 'despawning',
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
  },
  waiting: {
    PreToolUse: 'active',
    PostToolUse: 'active',
    Stop: 'idle',
    SessionEnd: 'despawning',
    Notification: 'waiting',
  },
  error: {
    PreToolUse: 'active',
    UserPromptSubmit: 'listening',
    Stop: 'idle',
    SessionEnd: 'despawning',
  },
  done: {
    UserPromptSubmit: 'listening',
    PreToolUse: 'active',
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

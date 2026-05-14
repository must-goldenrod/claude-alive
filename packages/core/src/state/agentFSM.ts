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
    Notification: 'waiting',
    Stop: 'idle',
    SessionEnd: 'despawning',
  },
  idle: {
    UserPromptSubmit: 'listening',
    PreToolUse: 'active',
    PermissionRequest: 'waiting',
    SessionEnd: 'despawning',
    // Claude Code fires `Notification` whenever it needs user attention
    // (permission prompts, idle reminders, AskUserQuestion completion).
    // Route to `waiting` so the tab turns orange instead of silently staying idle.
    Notification: 'waiting',
    TaskCompleted: 'done',
  },
  listening: {
    PreToolUse: 'active',
    PermissionRequest: 'waiting',
    Notification: 'waiting',
    Stop: 'idle',
    SessionEnd: 'despawning',
    TaskCompleted: 'done',
  },
  active: {
    PostToolUse: 'active',
    PostToolUseFailure: 'error',
    PreToolUse: 'active',
    PermissionRequest: 'waiting',
    Notification: 'waiting',
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
    Notification: 'waiting',
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

/**
 * Tools that, when invoked via PreToolUse, immediately put the agent into the
 * `waiting` state — they exist specifically to block on user input. The FSM table
 * routes PreToolUse → `active` by default, which is wrong for these tools because
 * the tab would flash green instead of the intended orange "needs attention".
 */
const USER_INPUT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

export function transition(
  currentState: AgentState,
  event: HookEventName,
  toolName?: string,
): FSMTransitionResult {
  // Special case: PreToolUse for a user-input tool jumps straight to `waiting`,
  // overriding the table's PreToolUse → `active` mapping. Once the user responds,
  // PostToolUse follows the normal table back to `active`.
  if (event === 'PreToolUse' && toolName && USER_INPUT_TOOLS.has(toolName)) {
    return { newState: 'waiting', toolAnimation: null, toolName };
  }
  const stateTransitions = TRANSITIONS[currentState];
  const newState = stateTransitions?.[event] ?? currentState;
  const toolAnimation = (newState === 'active' && toolName)
    ? toolToAnimation(toolName)
    : null;
  return { newState, toolAnimation, toolName: toolName ?? null };
}

export const HOOK_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Stop', 'Notification',
  'SubagentStart', 'SubagentStop', 'TeammateIdle',
  'TaskCompleted', 'ConfigChange', 'PreCompact',
  'WorktreeCreate', 'WorktreeRemove',
] as const;

export type HookEventName = (typeof HOOK_EVENTS)[number];

export const AGENT_STATES = [
  'spawning', 'idle', 'listening', 'active',
  'waiting', 'error', 'done', 'despawning', 'removed',
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

export const TOOL_ANIMATIONS = ['typing', 'reading', 'running', 'searching', 'thinking'] as const;
export type ToolAnimation = (typeof TOOL_ANIMATIONS)[number];

export interface HookEventPayload {
  event: HookEventName;
  tool: string;
  session_id: string;
  timestamp: number;
  data: HookEventData;
}

export interface HookEventData {
  session_id: string;
  hook_event_name: HookEventName;
  cwd: string;
  transcript_path?: string;
  permission_mode?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  tool_use_id?: string;
  prompt?: string;
  source?: string;
  reason?: string;
  agent_type?: string;
  agent_id?: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
  message?: string;
  notification_type?: string;
}

export interface AgentInfo {
  id: string;
  sessionId: string;
  state: AgentState;
  currentTool: string | null;
  currentToolAnimation: ToolAnimation | null;
  cwd: string;
  lastEvent: HookEventName | null;
  lastEventTime: number;
  parentId: string | null;
  createdAt: number;
}

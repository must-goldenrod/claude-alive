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

export interface CompletedSession {
  sessionId: string;
  cwd: string;
  projectName: string;
  completedAt: number;
  lastPrompt: string | null;
  displayName: string | null;
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
  /** User-assignable display name */
  displayName: string | null;
  /** Extracted from cwd — last folder component */
  projectName: string;
  /** Path to JSONL transcript file */
  transcriptPath: string | null;
  /** Total hook events received for this agent */
  totalEvents: number;
  /** Most recent user prompt text */
  lastPrompt: string | null;
  /** Accumulated list of unique tools used */
  toolsUsed: string[];
  /** Total tool call count (including duplicates) */
  toolCallCount: number;
  /** Per-tool call counts */
  toolCallCounts: Record<string, number>;
  /** Token usage from transcript parsing (populated after session ends) */
  tokenUsage: TokenUsage | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  apiCalls: number;
  model: string;
}

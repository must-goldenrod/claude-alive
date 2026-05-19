import type { HookEventPayload } from '@claude-alive/core';

export interface SpawnPlaceholderInput {
  mode?: 'claude' | 'shell';
  claudeVariant?: 'claude' | 'agents';
  claudeSessionId?: string;
  resumeSessionId?: string;
  cwd?: string;
}

/**
 * Synthesize a `SessionStart` hook payload so the dashboard sidebar shows a
 * UI-spawned tab immediately, grouped by its project cwd.
 *
 * Why this exists: the sidebar is entirely hook-driven (SessionStore creates an
 * agent on `SessionStart`, keyed by the hook's `session_id`). The chat tab is
 * linked to that agent via the session id we mint and pass to the CLI through
 * `claude --session-id <uuid>`.
 *
 * `claude agents` (background-agent manager) does NOT accept `--session-id`
 * (see buildClaudeCommand), so no real SessionStart ever reports our minted id.
 * The result was that starting a `claude agents` tab showed nothing in the
 * sidebar and the sidebar/terminal session info diverged.
 *
 * For that variant we register a placeholder agent under the minted session id +
 * tab cwd. Returns null when a placeholder is unnecessary (shell mode, or the
 * normal `claude` variant where a real `--session-id` SessionStart will arrive).
 */
export function buildSpawnPlaceholderEvent(
  msg: SpawnPlaceholderInput,
): HookEventPayload | null {
  if ((msg.mode ?? 'claude') !== 'claude') return null;
  // Only the `agents` variant cannot echo our session id back via the CLI.
  if ((msg.claudeVariant ?? 'claude') !== 'agents') return null;

  const sessionId = msg.resumeSessionId || msg.claudeSessionId;
  if (!sessionId) return null;

  return {
    event: 'SessionStart',
    tool: 'system',
    session_id: sessionId,
    timestamp: Date.now(),
    data: {
      session_id: sessionId,
      hook_event_name: 'SessionStart',
      cwd: msg.cwd ?? '',
    },
  };
}

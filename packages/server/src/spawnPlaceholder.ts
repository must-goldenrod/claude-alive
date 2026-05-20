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
 * Empirically, Claude Code CLI does NOT reliably fire the `SessionStart` hook
 * with the id we passed via `--session-id`:
 *   - `claude agents`: rejects `--session-id` outright (no hook ever matches).
 *   - `claude`        : even with `--session-id <uuid>`, the SessionStart hook
 *     payload often doesn't echo that uuid back (verified on CLI 2.1.x — UI-
 *     spawned `claude --session-id ...` processes never appeared in
 *     `/api/agents` while external `claude` invocations did).
 * In both cases the sidebar/animation stays empty for UI-spawned tabs.
 *
 * Fix: for any UI-spawned claude tab, synthesize a placeholder SessionStart
 * with the minted id + tab cwd. If the real SessionStart later arrives with the
 * same id (the happy path for `claude`), `SessionStore.createAgent` is
 * idempotent on (sessionId, cwd) and just refreshes the entry — no harm done.
 * Shell mode (SSH presets / freeform terminals) is still a no-op since there
 * is no Claude session to anchor on.
 */
export function buildSpawnPlaceholderEvent(
  msg: SpawnPlaceholderInput,
): HookEventPayload | null {
  if ((msg.mode ?? 'claude') !== 'claude') return null;

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

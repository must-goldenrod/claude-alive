/**
 * Template for Claude Code settings.json hook block.
 * Installed/removed by `think-prompt install` / `uninstall`.
 */

export interface HookBlock {
  matcher: string;
  hooks: Array<{ type: 'http' | 'command'; url?: string; command?: string; timeout: number }>;
}

export function buildHookBlocks(agentPort: number): Record<string, HookBlock[]> {
  const url = (path: string) => `http://127.0.0.1:${agentPort}/v1/hook/${path}`;
  const mk = (path: string, timeout: number): HookBlock => ({
    matcher: '',
    hooks: [{ type: 'http', url: url(path), timeout }],
  });
  return {
    UserPromptSubmit: [mk('user-prompt-submit', 3)],
    SessionStart: [mk('session-start', 2)],
    SubagentStart: [mk('subagent-start', 2)],
    SubagentStop: [mk('subagent-stop', 2)],
    PostToolUse: [mk('post-tool-use', 3)],
    Stop: [mk('stop', 5)],
  };
}

export const HOOK_KEYS = [
  'UserPromptSubmit',
  'SessionStart',
  'SubagentStart',
  'SubagentStop',
  'PostToolUse',
  'Stop',
] as const;

/**
 * A hook block in the claude settings.json is "ours" if any of its hooks
 * points at the think-prompt agent URL.
 */
export function isOurHookBlock(block: unknown): boolean {
  if (!block || typeof block !== 'object') return false;
  const hooks = (block as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) => {
    const url = (h as { url?: unknown })?.url;
    return typeof url === 'string' && url.includes('/v1/hook/') && url.includes('127.0.0.1');
  });
}

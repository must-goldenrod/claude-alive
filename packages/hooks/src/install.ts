import { readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK_EVENTS_TO_REGISTER = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Stop', 'Notification',
  'SubagentStart', 'SubagentStop', 'TaskCompleted',
  'PreCompact', 'TeammateIdle', 'ConfigChange',
  'WorktreeCreate', 'WorktreeRemove',
] as const;

interface HookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command?: string;
    url?: string;
    async?: boolean;
    timeout: number;
  }>;
}

/**
 * Legacy hook entries from before claude-alive absorbed think-prompt
 * (D-048+). The standalone think-prompt agent listened on
 * 127.0.0.1:47823 and Claude Code posted to `/v1/hook/*` via `http`-type
 * hooks. Those entries are now dead weight: the unified server on :3141
 * receives all events through the single command-type wrapper and
 * fans them out internally. installHooks() strips them on every run
 * so existing installations migrate transparently.
 */
function isLegacyThinkPromptHook(entry: HookEntry): boolean {
  return (
    entry.hooks?.some(
      (h) =>
        h.type === 'http' &&
        typeof h.url === 'string' &&
        h.url.includes('/v1/hook/') &&
        (h.url.includes('127.0.0.1') || h.url.includes('localhost'))
    ) ?? false
  );
}

function isClaudeAliveHook(entry: HookEntry): boolean {
  return (
    entry.hooks?.some(
      (h) => typeof h.command === 'string' && h.command.includes('claude-alive')
    ) ?? false
  );
}

interface SettingsJson {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

export function installHooks(): { installed: boolean; settingsPath: string; hookScriptPath: string } {
  const home = homedir();
  const claudeDir = join(home, '.claude');
  const aliveDir = join(home, '.claude-alive', 'hooks');
  const settingsPath = join(claudeDir, 'settings.json');

  // 1. Copy hook script to ~/.claude-alive/hooks/
  mkdirSync(aliveDir, { recursive: true });
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const srcScript = join(currentDir, '..', 'scripts', 'stream-event.sh');
  const destScript = join(aliveDir, 'stream-event.sh');
  copyFileSync(srcScript, destScript);
  if (process.platform !== 'win32') {
    chmodSync(destScript, 0o755);
  }

  // 2. Read or create settings.json
  let settings: SettingsJson = {};
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    settings = JSON.parse(raw) as SettingsJson;
  } catch {
    mkdirSync(claudeDir, { recursive: true });
  }

  // 3. Backup existing settings
  if (Object.keys(settings).length > 0) {
    writeFileSync(settingsPath + '.backup', JSON.stringify(settings, null, 2));
  }

  // 4. Merge hooks
  if (!settings.hooks) {
    settings.hooks = {};
  }

  const hookCommand = destScript;

  for (const event of HOOK_EVENTS_TO_REGISTER) {
    const existing = settings.hooks[event] ?? [];
    // Drop any legacy think-prompt http hooks that targeted the old
    // standalone agent on :47823; the unified server fans events out
    // internally now, so a single claude-alive entry per event suffices.
    const pruned = existing.filter((entry) => !isLegacyThinkPromptHook(entry));
    const alreadyInstalled = pruned.some(isClaudeAliveHook);

    if (!alreadyInstalled) {
      pruned.push({
        matcher: '',
        hooks: [{
          type: 'command',
          command: hookCommand,
          async: true,
          timeout: 5,
        }],
      });
    }
    settings.hooks[event] = pruned;
  }

  // Some events may now have only legacy entries; drop empty arrays.
  for (const event of Object.keys(settings.hooks)) {
    if ((settings.hooks[event] ?? []).length === 0) {
      delete settings.hooks[event];
    }
  }

  // 5. Write settings
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  return { installed: true, settingsPath, hookScriptPath: destScript };
}

export function uninstallHooks(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw) as SettingsJson;
    if (settings.hooks) {
      for (const event of Object.keys(settings.hooks)) {
        settings.hooks[event] = (settings.hooks[event] ?? []).filter(
          (entry) => !isClaudeAliveHook(entry) && !isLegacyThinkPromptHook(entry)
        );
        if (settings.hooks[event]!.length === 0) {
          delete settings.hooks[event];
        }
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch {
    // settings.json doesn't exist — nothing to uninstall
  }
}

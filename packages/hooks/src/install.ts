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
    command: string;
    async: boolean;
    timeout: number;
  }>;
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
    const alreadyInstalled = existing.some((entry) =>
      entry.hooks?.some((h) => h.command.includes('claude-alive'))
    );

    if (!alreadyInstalled) {
      existing.push({
        matcher: '',
        hooks: [{
          type: 'command',
          command: hookCommand,
          async: true,
          timeout: 5,
        }],
      });
      settings.hooks[event] = existing;
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
        settings.hooks[event] = (settings.hooks[event] ?? []).filter((entry) =>
          !entry.hooks?.some((h) => h.command.includes('claude-alive'))
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

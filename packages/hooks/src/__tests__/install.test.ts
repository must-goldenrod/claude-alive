import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test install/uninstall by mocking homedir to a temp directory
const TEST_HOME = join(tmpdir(), `claude-alive-test-${Date.now()}`);

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return { ...original, homedir: () => TEST_HOME };
});

// Dynamic import after mock is set up
const { installHooks, uninstallHooks } = await import('../install.js');

describe('installHooks', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_HOME, '.claude'), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it('creates settings.json with hooks when none exists', () => {
    const result = installHooks();
    expect(result.installed).toBe(true);

    const settings = JSON.parse(readFileSync(join(TEST_HOME, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.SessionEnd).toBeDefined();
    expect(settings.hooks.PreToolUse).toBeDefined();
  });

  it('merges hooks into existing settings without overwriting', () => {
    const existing = { customSetting: true, hooks: {} };
    writeFileSync(join(TEST_HOME, '.claude', 'settings.json'), JSON.stringify(existing));

    installHooks();

    const settings = JSON.parse(readFileSync(join(TEST_HOME, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.customSetting).toBe(true);
    expect(settings.hooks.SessionStart).toBeDefined();
  });

  it('does not duplicate hooks on repeated install', () => {
    installHooks();
    installHooks();

    const settings = JSON.parse(readFileSync(join(TEST_HOME, '.claude', 'settings.json'), 'utf-8'));
    // Each event should have exactly one entry
    expect(settings.hooks.SessionStart.length).toBe(1);
  });

  it('creates backup of existing settings', () => {
    const existing = { original: true };
    writeFileSync(join(TEST_HOME, '.claude', 'settings.json'), JSON.stringify(existing));

    installHooks();

    const backupPath = join(TEST_HOME, '.claude', 'settings.json.backup');
    expect(existsSync(backupPath)).toBe(true);
    const backup = JSON.parse(readFileSync(backupPath, 'utf-8'));
    expect(backup.original).toBe(true);
  });

  it('copies stream-event.sh to ~/.claude-alive/hooks/', () => {
    const result = installHooks();
    expect(existsSync(result.hookScriptPath)).toBe(true);
  });

  it('sets hook as async with 5s timeout', () => {
    installHooks();
    const settings = JSON.parse(readFileSync(join(TEST_HOME, '.claude', 'settings.json'), 'utf-8'));
    const hook = settings.hooks.SessionStart[0].hooks[0];
    expect(hook.async).toBe(true);
    expect(hook.timeout).toBe(5);
  });
});

describe('uninstallHooks', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_HOME, '.claude'), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it('removes claude-alive hooks from settings', () => {
    installHooks();
    uninstallHooks();

    const settings = JSON.parse(readFileSync(join(TEST_HOME, '.claude', 'settings.json'), 'utf-8'));
    // hooks key should be deleted when empty
    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other hooks during uninstall', () => {
    const existing = {
      hooks: {
        SessionStart: [{
          matcher: '',
          hooks: [{ type: 'command', command: '/usr/bin/other-tool', async: true, timeout: 5 }],
        }],
      },
    };
    writeFileSync(join(TEST_HOME, '.claude', 'settings.json'), JSON.stringify(existing));

    installHooks();
    uninstallHooks();

    const settings = JSON.parse(readFileSync(join(TEST_HOME, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.SessionStart.length).toBe(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('/usr/bin/other-tool');
  });

  it('handles missing settings.json gracefully', () => {
    // Should not throw
    expect(() => uninstallHooks()).not.toThrow();
  });
});

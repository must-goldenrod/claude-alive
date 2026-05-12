import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { HOOK_KEYS, type HookBlock, buildHookBlocks, isOurHookBlock } from './hook-template.js';

export interface MergeResult {
  changed: boolean;
  backupPath?: string | undefined;
}

type ClaudeSettings = {
  hooks?: Record<string, HookBlock[] | undefined>;
  [key: string]: unknown;
};

export function mergeHooksIntoSettings(settingsPath: string, agentPort: number): MergeResult {
  mkdirSync(dirname(settingsPath), { recursive: true });
  let obj: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf8');
      obj = (raw.trim().length > 0 ? JSON.parse(raw) : {}) as ClaudeSettings;
    } catch {
      // Back up unreadable settings and start fresh with our hooks block only.
      const backup = `${settingsPath}.unreadable-${Date.now()}.bak`;
      copyFileSync(settingsPath, backup);
      obj = {};
    }
  }
  const before = JSON.stringify(obj);
  if (!obj.hooks || typeof obj.hooks !== 'object') obj.hooks = {};
  const blocks = buildHookBlocks(agentPort);
  for (const key of HOOK_KEYS) {
    const existingList: HookBlock[] = Array.isArray(obj.hooks[key]) ? obj.hooks[key]! : [];
    const filtered = existingList.filter((b) => !isOurHookBlock(b));
    filtered.push(...blocks[key]!);
    obj.hooks[key] = filtered;
  }
  const after = JSON.stringify(obj);
  if (before === after) return { changed: false };
  // Back up previous version if it existed
  let backupPath: string | undefined;
  if (existsSync(settingsPath)) {
    backupPath = `${settingsPath}.bak-${Date.now()}`;
    copyFileSync(settingsPath, backupPath);
  }
  writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return { changed: true, backupPath };
}

export function removeHooksFromSettings(settingsPath: string): MergeResult {
  if (!existsSync(settingsPath)) return { changed: false };
  let obj: ClaudeSettings;
  try {
    obj = JSON.parse(readFileSync(settingsPath, 'utf8')) as ClaudeSettings;
  } catch {
    return { changed: false };
  }
  if (!obj.hooks || typeof obj.hooks !== 'object') return { changed: false };
  const before = JSON.stringify(obj);
  for (const key of HOOK_KEYS) {
    const list = obj.hooks[key];
    if (!Array.isArray(list)) continue;
    const filtered = list.filter((b) => !isOurHookBlock(b));
    if (filtered.length === 0) delete obj.hooks[key];
    else obj.hooks[key] = filtered;
  }
  if (Object.keys(obj.hooks).length === 0) delete obj.hooks;
  const after = JSON.stringify(obj);
  if (before === after) return { changed: false };
  const backupPath = `${settingsPath}.bak-${Date.now()}`;
  copyFileSync(settingsPath, backupPath);
  writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return { changed: true, backupPath };
}

export function hooksPresent(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return false;
  try {
    const obj = JSON.parse(readFileSync(settingsPath, 'utf8'));
    if (!obj?.hooks) return false;
    for (const key of HOOK_KEYS) {
      const list = obj.hooks[key];
      if (!Array.isArray(list)) continue;
      if (list.some(isOurHookBlock)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Persists the set of open Claude terminal tabs to localStorage so a browser
 * refresh (or a full server restart) can restore them. Only the metadata needed
 * to reattach (tabId) or resume (claudeSessionId, cwd, ...) is stored — never
 * terminal output, which the server replays from its own scrollback buffer.
 */
import type { TerminalMode } from '@claude-alive/core';

const STORAGE_KEY = 'claude-alive:open-tabs';
const MAX_TABS = 50;

export interface PersistedTab {
  tabId: string;
  claudeSessionId?: string;
  cwd?: string;
  label: string;
  mode: TerminalMode;
  claudeVariant?: 'claude' | 'agents';
  displayName?: string;
}

export function loadOpenTabs(): PersistedTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedTab[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t.tabId === 'string')
      // Drop legacy counter-format ids (`tab-1`, `tab-2`, …). Those were minted by
      // a per-load counter that reset each reload, so they collide with unrelated
      // server terminals — restoring them attaches to the wrong (or a missing)
      // session and shows a blank terminal. Only UUID-format ids are trustworthy.
      .filter((t) => !/^tab-\d+$/.test(t.tabId))
      .slice(0, MAX_TABS);
  } catch {
    return [];
  }
}

export function saveOpenTabs(tabs: PersistedTab[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.slice(0, MAX_TABS)));
  } catch {
    // localStorage may be full or disabled (private mode) — fail silently.
  }
}

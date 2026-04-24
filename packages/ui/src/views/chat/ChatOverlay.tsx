import { useRef, useEffect, useState, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { WSServerMessage, TerminalMode as TerminalSpawnMode, TerminalSource } from '@claude-alive/core';
import { TerminalTabBar } from './TerminalTabBar.tsx';
import type { Tab } from './TerminalTabBar.tsx';
import { SSHPresetDialog } from './SSHPresetDialog.tsx';
import {
  loadPresets,
  createPreset,
  updatePreset as updatePresetStore,
  deletePreset as deletePresetStore,
} from './sshPresets.ts';
import type { SSHPreset, SSHPresetDraft } from './sshPresets.ts';

export type TerminalEventHandler = (msg: WSServerMessage) => void;

/** Parameters passed to the spawn callback. */
export interface SpawnRequest {
  tabId: string;
  cwd?: string;
  skipPermissions?: boolean;
  mode: TerminalSpawnMode;
  source: TerminalSource;
  initialCommand?: string;
  /** UUID passed via `claude --session-id` to 1:1 pair the tab with a Claude session. */
  claudeSessionId?: string;
  /** Pre-existing Claude session UUID to resume via `claude --resume`. Wins over claudeSessionId. */
  resumeSessionId?: string;
  /** Initial display name passed via `claude -n`. */
  displayName?: string;
}

/** Lightweight SSH tab projection broadcast to App so the sidebar can show a presence indicator. */
export interface SshSessionInfo {
  tabId: string;
  label: string;
  presetId?: string;
  status: 'idle' | 'active' | 'done';
  exited: boolean;
  hasError: boolean;
}

/** Idle-timeout after the last output before a tab transitions from active → idle (ms). */
const ACTIVITY_IDLE_MS = 1500;

type TerminalMode = 'popup' | 'bottom' | 'right' | 'fullscreen';

const MIN_BOTTOM_HEIGHT = 150;
const MAX_BOTTOM_RATIO = 0.85; // 85% of viewport height
const MIN_RIGHT_WIDTH = 200;
const MAX_RIGHT_RATIO = 0.75; // 75% of viewport width

interface ChatOverlayProps {
  open: boolean;
  onToggle: () => void;
  onSpawn?: (req: SpawnRequest) => void;
  onInput?: (tabId: string, data: string) => void;
  onResize?: (tabId: string, cols: number, rows: number) => void;
  onClose?: (tabId: string) => void;
  terminalEventRef?: MutableRefObject<TerminalEventHandler | null>;
  projectPaths?: string[];
  /**
   * When true, the overlay animates to a full body-area layout (below header, right of left
   * sidebar). The mode-switcher, resize handles, minimize button, and floating collapsed bar
   * are suppressed. The terminal does not move in the DOM — its fixed-position coordinates
   * change and CSS transitions produce the "sliding" animation.
   */
  listViewActive?: boolean;
  /** Pixel width of the visible left sidebar. Used to compute the list-view left inset. */
  listLeftInset?: number;
  /** Called whenever the set of SSH tabs changes. Enables App/Sidebar to show a presence indicator. */
  onSshSessionsChange?: (sessions: SshSessionInfo[]) => void;
  /**
   * Agent name map keyed by sessionId (Claude session UUID). Used to auto-sync sidebar renames
   * into terminal tab labels. Expected shape: `{ [sessionId]: displayName }`.
   */
  agentNames?: Record<string, string | null>;
}

const TERM_OPTIONS = {
  fontFamily: 'SF Mono, Monaco, Menlo, monospace',
  fontSize: 13,
  lineHeight: 1.4,
  theme: {
    background: 'transparent',
    foreground: '#c9d1d9',
    cursor: '#58a6ff',
    cursorAccent: '#0d1117',
    selectionBackground: 'rgba(88, 166, 255, 0.3)',
    black: '#0d1117',
    red: '#ff7b72',
    green: '#7ee787',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39d353',
    white: '#c9d1d9',
    brightBlack: '#484f58',
    brightRed: '#ffa198',
    brightGreen: '#7ee787',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d364',
    brightWhite: '#f0f6fc',
  },
  cursorBlink: true,
  cursorStyle: 'block' as const,
  allowTransparency: true,
  scrollback: 5000,
};

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

const HEADER_HEIGHT = 56;

function getListViewStyle(listLeftInset: number): React.CSSProperties {
  return {
    position: 'fixed',
    zIndex: 30,
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(13, 17, 23, 0.92)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: 'none',
    borderTop: '1px solid var(--border-color)',
    borderLeft: listLeftInset > 0 ? '1px solid var(--border-color)' : 'none',
    overflow: 'hidden',
    top: HEADER_HEIGHT,
    left: listLeftInset,
    width: `calc(100vw - ${listLeftInset}px)`,
    height: `calc(100vh - ${HEADER_HEIGHT}px)`,
    borderRadius: 0,
    transform: 'none',
  };
}

// Transition applied to the overlay root in every mode. Animates when listViewActive toggles,
// mode changes, or sidebar inset changes — the terminal visibly "slides" between layouts.
// Durations tripled from the initial 420ms for a slower, more deliberate feel.
const OVERLAY_TRANSITION = [
  'top 1260ms cubic-bezier(0.22, 1, 0.36, 1)',
  'left 1260ms cubic-bezier(0.22, 1, 0.36, 1)',
  'right 1260ms cubic-bezier(0.22, 1, 0.36, 1)',
  'bottom 1260ms cubic-bezier(0.22, 1, 0.36, 1)',
  'width 1260ms cubic-bezier(0.22, 1, 0.36, 1)',
  'height 1260ms cubic-bezier(0.22, 1, 0.36, 1)',
  'transform 1260ms cubic-bezier(0.22, 1, 0.36, 1)',
  'border-radius 960ms ease',
  'opacity 720ms ease',
].join(', ');

function getModeStyle(mode: TerminalMode, bottomHeight?: number, rightWidth?: number): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'fixed',
    zIndex: 30,
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(13, 17, 23, 0.92)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid var(--border-color)',
    overflow: 'hidden',
    transition: 'all 250ms ease',
  };

  switch (mode) {
    case 'popup':
      return {
        ...base,
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(640px, 90vw)',
        height: '45vh',
        borderRadius: 16,
      };
    case 'bottom':
      return {
        ...base,
        bottom: 0,
        left: 0,
        right: 0,
        height: bottomHeight ?? '50vh',
        borderRadius: 0,
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: 'none',
      };
    case 'right':
      return {
        ...base,
        top: HEADER_HEIGHT,
        right: 0,
        bottom: 0,
        width: rightWidth ?? 'min(480px, 40vw)',
        borderRadius: 0,
        borderRight: 'none',
        borderTop: 'none',
        borderBottom: 'none',
      };
    case 'fullscreen':
      return {
        ...base,
        top: HEADER_HEIGHT,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 0,
        border: 'none',
        borderTop: '1px solid var(--border-color)',
      };
  }
}

let tabCounter = 0;

function makeTabId(): string {
  return `tab-${++tabCounter}`;
}

function pathBasename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
}

/**
 * Fallback v4-ish UUID for environments without `crypto.randomUUID`.
 * Claude CLI validates UUID format, so we keep the canonical 8-4-4-4-12 hex layout.
 */
function generateFallbackUuid(): string {
  const rnd = () => Math.random().toString(16).slice(2, 10);
  const a = rnd();
  const b = rnd().slice(0, 4);
  const c = '4' + rnd().slice(0, 3);
  const d = ((parseInt(rnd().slice(0, 1), 16) & 0x3) | 0x8).toString(16) + rnd().slice(0, 3);
  const e = rnd() + rnd().slice(0, 4);
  return `${a}-${b}-${c}-${d}-${e}`;
}

// Mode button SVG icons
function ModeIcon({ mode, size = 14 }: { mode: TerminalMode; size?: number }) {
  const s = size;
  switch (mode) {
    case 'popup':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <rect x="3" y="4" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'bottom':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <rect x="1" y="8" width="14" height="7" rx="1" fill="currentColor" opacity="0.4" />
        </svg>
      );
    case 'right':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <rect x="9" y="1" width="6" height="14" rx="1" fill="currentColor" opacity="0.4" />
        </svg>
      );
    case 'fullscreen':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="2" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
  }
}

const MODES: TerminalMode[] = ['popup', 'bottom', 'right', 'fullscreen'];
const MODE_I18N: Record<TerminalMode, string> = {
  popup: 'terminal.modePopup',
  bottom: 'terminal.modeBottom',
  right: 'terminal.modeRight',
  fullscreen: 'terminal.modeFullscreen',
};

export function ChatOverlay({ open, onToggle, onSpawn, onInput, onResize, onClose, terminalEventRef, projectPaths = [], listViewActive = false, listLeftInset = 0, onSshSessionsChange, agentNames }: ChatOverlayProps) {
  const { t } = useTranslation();
  const isListView = listViewActive;

  const [mode, setMode] = useState<TerminalMode>('popup');
  const [bottomHeight, setBottomHeight] = useState<number | undefined>(undefined);
  const [rightWidth, setRightWidth] = useState<number | undefined>(undefined);
  const resizingRef = useRef<'bottom' | 'right' | null>(null);

  // Stable refs for callbacks — prevents useEffect re-runs on callback reference changes
  const onSpawnRef = useRef(onSpawn);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const onCloseRef = useRef(onClose);
  const onSshSessionsChangeRef = useRef(onSshSessionsChange);
  onSpawnRef.current = onSpawn;
  onInputRef.current = onInput;
  onResizeRef.current = onResize;
  onCloseRef.current = onClose;
  onSshSessionsChangeRef.current = onSshSessionsChange;

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [_browsePath, setBrowsePath] = useState('~');
  const [browseDirs, setBrowseDirs] = useState<{ name: string; path: string }[]>([]);
  const [browseCurrentPath, setBrowseCurrentPath] = useState('');
  const [browseLoading, setBrowseLoading] = useState(false);

  // SSH preset state
  const [presets, setPresets] = useState<SSHPreset[]>(() => loadPresets());
  const [sshDialogOpen, setSshDialogOpen] = useState(false);

  // Previous Claude sessions for the currently-browsed cwd
  interface PastSession {
    sessionId: string;
    cwd: string;
    startedAt: number;
    lastActivity: number;
    preview: string;
    sizeBytes: number;
  }
  const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
  const [pastSessionsLoading, setPastSessionsLoading] = useState(false);

  // Per-tab xterm instances
  const termsRef = useRef(new Map<string, { term: Terminal; fit: FitAddon }>());
  // Per-tab container divs
  const containersRef = useRef(new Map<string, HTMLDivElement>());
  // Per-tab idle-timer handles (for active → idle transition)
  const idleTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Wrapper that holds all tab containers. ChatOverlay is always mounted at the App level
  // and the terminal moves between layouts via CSS transitions on position/size — the DOM
  // is never relocated, so a simple useRef is sufficient.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Track if we've initialized on first open
  const initializedRef = useRef(false);

  /** Transition a tab to "active" and (re)schedule the idle timer. */
  const markTabActivity = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === tabId && !tab.exited ? { ...tab, status: 'active' } : tab)),
    );
    const existing = idleTimersRef.current.get(tabId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      idleTimersRef.current.delete(tabId);
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId && !tab.exited && tab.status === 'active'
            ? { ...tab, status: 'idle' }
            : tab,
        ),
      );
    }, ACTIVITY_IDLE_MS);
    idleTimersRef.current.set(tabId, timer);
  }, []);

  interface CreateTabOptions {
    cwd?: string;
    dangerousSkip?: boolean;
    mode?: TerminalSpawnMode;
    source?: TerminalSource;
    initialCommand?: string;
    sshPresetId?: string;
    label?: string;
    /** If set, pass to `claude --resume <uuid>`. Wins over newly-generated claudeSessionId. */
    resumeSessionId?: string;
    /** Optional display name for `claude -n <name>`. */
    displayName?: string;
  }

  // Create a new tab: allocate xterm, mount to container, call onSpawn
  const createTab = useCallback(
    (opts: CreateTabOptions = {}) => {
      const tabId = makeTabId();
      const mode: TerminalSpawnMode = opts.mode ?? 'claude';
      const source: TerminalSource = opts.source ?? 'local';
      const defaultLabel = opts.cwd
        ? pathBasename(opts.cwd)
        : t('terminal.tabLabel', { n: tabCounter });
      const label = opts.label ?? defaultLabel;

      // Assign a Claude session UUID for 1:1 matching with the sidebar agent.
      // `--resume` reuses an existing session; otherwise we mint a new v4 UUID to hand via --session-id.
      const claudeSessionId =
        mode === 'claude'
          ? opts.resumeSessionId ?? (crypto.randomUUID?.() ?? generateFallbackUuid())
          : undefined;

      setTabs((prev) => [
        ...prev,
        {
          id: tabId,
          label,
          exited: false,
          status: 'idle',
          source,
          sshPresetId: opts.sshPresetId,
          claudeSessionId,
        },
      ]);
      setActiveTabId(tabId);

      // Defer xterm creation to next frame so the container div exists
      requestAnimationFrame(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        const container = document.createElement('div');
        container.style.flex = '1';
        container.style.padding = '8px 12px';
        container.style.overflow = 'hidden';
        container.style.height = '100%';
        wrapper.appendChild(container);
        containersRef.current.set(tabId, container);

        const term = new Terminal(TERM_OPTIONS);
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(container);
        termsRef.current.set(tabId, { term, fit });

        requestAnimationFrame(() => {
          fit.fit();
          onResizeRef.current?.(tabId, term.cols, term.rows);
          term.focus();
        });

        term.onData((data) => {
          onInputRef.current?.(tabId, data);
        });

        onSpawnRef.current?.({
          tabId,
          cwd: opts.cwd,
          skipPermissions: opts.dangerousSkip,
          mode,
          source,
          initialCommand: opts.initialCommand,
          claudeSessionId: opts.resumeSessionId ? undefined : claudeSessionId,
          resumeSessionId: opts.resumeSessionId,
          displayName: opts.displayName,
        });
      });

      return tabId;
    },
    [t],
  );

  const fetchPastSessions = useCallback((cwd: string) => {
    if (!cwd) {
      setPastSessions([]);
      return;
    }
    setPastSessionsLoading(true);
    fetch(`${API_BASE}/api/claude/sessions?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((data: { sessions: PastSession[] }) => {
        setPastSessions(Array.isArray(data.sessions) ? data.sessions : []);
      })
      .catch(() => setPastSessions([]))
      .finally(() => setPastSessionsLoading(false));
  }, []);

  const fetchBrowse = useCallback(
    (dir: string) => {
      setBrowseLoading(true);
      fetch(`${API_BASE}/api/fs/browse?dir=${encodeURIComponent(dir)}`)
        .then((r) => r.json())
        .then((data: { path: string; dirs: { name: string; path: string }[] }) => {
          setBrowseCurrentPath(data.path);
          setBrowseDirs(data.dirs);
          setBrowsePath(data.path);
          // Kick off past-sessions fetch for this directory in parallel.
          fetchPastSessions(data.path);
        })
        .catch(() => {})
        .finally(() => setBrowseLoading(false));
    },
    [fetchPastSessions],
  );

  const openLocalPicker = useCallback(() => {
    setCwdPickerOpen(true);
    setCustomPath('');
    fetchBrowse('~');
  }, [fetchBrowse]);

  const launchPreset = useCallback(
    (preset: SSHPreset) => {
      setSshDialogOpen(false);
      createTab({
        mode: 'shell',
        source: 'ssh',
        initialCommand: preset.autoRun ? preset.command : undefined,
        sshPresetId: preset.id,
        label: preset.label,
      });
    },
    [createTab],
  );

  const handlePickCwd = useCallback(
    (cwd?: string) => {
      const skip = skipPermissions;
      setCwdPickerOpen(false);
      setCustomPath('');
      createTab({ cwd, dangerousSkip: skip, mode: 'claude', source: 'local' });
    },
    [createTab, skipPermissions],
  );

  const handleResumeSession = useCallback(
    (session: PastSession) => {
      setCwdPickerOpen(false);
      createTab({
        cwd: session.cwd,
        dangerousSkip: skipPermissions,
        mode: 'claude',
        source: 'local',
        resumeSessionId: session.sessionId,
        label: session.preview.slice(0, 32) || pathBasename(session.cwd),
      });
    },
    [createTab, skipPermissions],
  );

  const handleSavePreset = useCallback(
    (draft: SSHPresetDraft, editingId: string | null) => {
      if (editingId) {
        updatePresetStore(editingId, draft);
      } else {
        createPreset(draft);
      }
      setPresets(loadPresets());
    },
    [],
  );

  const handleDeletePreset = useCallback((id: string) => {
    deletePresetStore(id);
    setPresets(loadPresets());
  }, []);

  const handleRenameTab = useCallback((tabId: string, customLabel: string | null) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              customLabel: customLabel ?? undefined,
              // Mark as pinned so sidebar → tab auto-sync won't overwrite this manual edit.
              // Clearing the label (null) unpins so sync resumes.
              pinnedLabel: customLabel !== null,
            }
          : tab,
      ),
    );
  }, []);

  /**
   * Sidebar → tab auto-sync. When an agent is renamed in the sidebar, match it to the
   * terminal tab whose `claudeSessionId` equals that agent's sessionId, and propagate the
   * new name into the tab's `customLabel` — unless the user has pinned that tab by renaming
   * it manually (via double-click).
   */
  useEffect(() => {
    if (!agentNames) return;
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        if (!tab.claudeSessionId || tab.pinnedLabel) return tab;
        const incoming = agentNames[tab.claudeSessionId];
        const nextLabel = incoming && incoming.trim().length > 0 ? incoming : undefined;
        if (nextLabel === tab.customLabel) return tab;
        changed = true;
        return { ...tab, customLabel: nextLabel };
      });
      return changed ? next : prev;
    });
  }, [agentNames]);

  // Close a tab: dispose xterm, remove container, call onClose
  const closeTab = useCallback((tabId: string) => {
    const entry = termsRef.current.get(tabId);
    if (entry) {
      entry.term.dispose();
      termsRef.current.delete(tabId);
    }
    const container = containersRef.current.get(tabId);
    if (container) {
      container.remove();
      containersRef.current.delete(tabId);
    }
    const timer = idleTimersRef.current.get(tabId);
    if (timer) {
      clearTimeout(timer);
      idleTimersRef.current.delete(tabId);
    }
    onCloseRef.current?.(tabId);

    setTabs(prev => {
      const next = prev.filter(tab => tab.id !== tabId);
      if (next.length === 0) return next;
      return next;
    });

    setActiveTabId(prev => {
      if (prev !== tabId) return prev;
      // Switch to the last remaining tab
      const remaining = [...termsRef.current.keys()].filter(id => id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1]! : '';
    });
  }, []);

  // When active tab changes, show/hide containers and fit
  useEffect(() => {
    for (const [id, container] of containersRef.current) {
      container.style.display = id === activeTabId ? 'block' : 'none';
    }
    const entry = termsRef.current.get(activeTabId);
    if (entry) {
      requestAnimationFrame(() => {
        entry.fit.fit();
        entry.term.focus();
      });
    }
  }, [activeTabId]);

  // ResizeObserver for the wrapper — fit the active tab continuously.
  // During the 420ms view transition this fires on every paint, so xterm resizes
  // smoothly as the window animates between layouts.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const ro = new ResizeObserver(() => {
      const entry = termsRef.current.get(activeTabId);
      if (entry) {
        entry.fit.fit();
        onResizeRef.current?.(activeTabId, entry.term.cols, entry.term.rows);
      }
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [activeTabId]);

  // Final refit after the view transition settles. ResizeObserver may batch/skip
  // the last frame; this guarantees xterm reads final dimensions cleanly.
  // 1300ms ≈ 1260ms transition duration + 40ms buffer.
  useEffect(() => {
    const entry = termsRef.current.get(activeTabId);
    if (!entry) return;
    const timer = setTimeout(() => {
      entry.fit.fit();
      onResizeRef.current?.(activeTabId, entry.term.cols, entry.term.rows);
    }, 1300);
    return () => clearTimeout(timer);
  }, [listViewActive, listLeftInset, activeTabId]);

  // Re-fit terminals when mode changes (container size changes).
  // Matches the 1260ms positional transition + 40ms buffer.
  useEffect(() => {
    const entry = termsRef.current.get(activeTabId);
    if (entry) {
      const timer = setTimeout(() => {
        entry.fit.fit();
        onResizeRef.current?.(activeTabId, entry.term.cols, entry.term.rows);
      }, 1300);
      return () => clearTimeout(timer);
    }
  }, [mode, activeTabId]);

  // Initialize first tab when overlay opens — show picker instead of auto-creating
  useEffect(() => {
    if (open && !initializedRef.current) {
      initializedRef.current = true;
      setCwdPickerOpen(true);
      fetchBrowse('~');
    }
  }, [open, fetchBrowse]);

  // Focus active terminal when overlay opens
  useEffect(() => {
    if (open && !cwdPickerOpen) {
      setTimeout(() => {
        termsRef.current.get(activeTabId)?.term.focus();
      }, 100);
    }
  }, [open, activeTabId, cwdPickerOpen]);

  // Broadcast SSH tab projection to parent so the sidebar can show a presence indicator.
  // We can't hook-track remote activity (hooks run locally only) but at least the user
  // sees that an SSH session is open, its label, and whether it's sending output.
  useEffect(() => {
    const sshSessions: SshSessionInfo[] = tabs
      .filter((t) => t.source === 'ssh')
      .map((t) => ({
        tabId: t.id,
        label: t.customLabel ?? t.label,
        presetId: t.sshPresetId,
        status: t.status,
        exited: t.exited,
        hasError: !!t.sshError,
      }));
    onSshSessionsChangeRef.current?.(sshSessions);
  }, [tabs]);

  // Register terminal event handler for incoming server messages
  useEffect(() => {
    if (!terminalEventRef) return;
    terminalEventRef.current = (msg: WSServerMessage) => {
      if (msg.type === 'terminal:output') {
        termsRef.current.get(msg.tabId)?.term.write(msg.data);
        markTabActivity(msg.tabId);
      } else if (msg.type === 'terminal:exited') {
        const timer = idleTimersRef.current.get(msg.tabId);
        if (timer) {
          clearTimeout(timer);
          idleTimersRef.current.delete(msg.tabId);
        }
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === msg.tabId
              ? { ...tab, exited: true, exitCode: msg.exitCode, status: 'done' }
              : tab,
          ),
        );
      } else if (msg.type === 'terminal:ssh-error') {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === msg.tabId
              ? { ...tab, sshError: { kind: msg.kind, line: msg.line } }
              : tab,
          ),
        );
      }
    };
    return () => {
      terminalEventRef.current = null;
    };
  }, [terminalEventRef, markTabActivity]);

  // Resize drag handler
  const handleResizeStart = useCallback((edge: 'bottom' | 'right') => {
    resizingRef.current = edge;
    document.body.style.cursor = edge === 'bottom' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (e: MouseEvent) => {
      if (resizingRef.current === 'bottom') {
        const h = Math.min(
          Math.max(window.innerHeight - e.clientY, MIN_BOTTOM_HEIGHT),
          window.innerHeight * MAX_BOTTOM_RATIO,
        );
        setBottomHeight(h);
      } else if (resizingRef.current === 'right') {
        const w = Math.min(
          Math.max(window.innerWidth - e.clientX, MIN_RIGHT_WIDTH),
          window.innerWidth * MAX_RIGHT_RATIO,
        );
        setRightWidth(w);
      }
    };

    const onMouseUp = () => {
      resizingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Cleanup all terminals on unmount
  useEffect(() => {
    const timers = idleTimersRef.current;
    const terms = termsRef.current;
    const containers = containersRef.current;
    return () => {
      for (const { term } of terms.values()) term.dispose();
      for (const timer of timers.values()) clearTimeout(timer);
      terms.clear();
      containers.clear();
      timers.clear();
      initializedRef.current = false;
    };
  }, []);

  // Re-fit terminal when expanding from collapsed state
  useEffect(() => {
    if (open && activeTabId) {
      const entry = termsRef.current.get(activeTabId);
      if (entry) {
        requestAnimationFrame(() => {
          entry.fit.fit();
          entry.term.focus();
        });
      }
    }
  }, [open, activeTabId]);

  const uniquePaths = [...new Set(projectPaths)];
  const hasTabs = tabs.length > 0;

  if (!open && !hasTabs && !isListView) return null;

  // Compose root style: the mode/list layout geometry plus a shared transition so changes
  // to any positioning property animate. Opacity handles open/close; transform: none in
  // list-view clears the popup's translateX so the terminal "slides" to its new position.
  const layoutStyle = isListView
    ? getListViewStyle(listLeftInset)
    : getModeStyle(mode, bottomHeight, rightWidth);
  const rootStyle: React.CSSProperties = {
    ...layoutStyle,
    transition: resizingRef.current ? 'none' : OVERLAY_TRANSITION,
    opacity: open ? 1 : 0,
    pointerEvents: open ? 'auto' : 'none',
  };

  const tree = (
    <>
      {/* Collapsed minimized bar — only in floating overlay mode; list view always visible. */}
      {!isListView && !open && hasTabs && (
        <button
          onClick={onToggle}
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            background: 'rgba(13, 17, 23, 0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            transition: 'all 0.2s ease',
          }}
        >
          <span style={{ fontSize: 13 }}>▣</span>
          <span>{t('chat.title')}</span>
          <span style={{
            background: 'rgba(88, 166, 255, 0.2)',
            color: 'var(--accent-blue)',
            borderRadius: 8,
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 600,
          }}>
            {tabs.length}
          </span>
          <span style={{ fontSize: 10, opacity: 0.5 }}>▲</span>
        </button>
      )}

      {/* Always render overlay to preserve xterm DOM — hide with opacity when closed */}
      <div style={rootStyle}>
      {/* Resize handles — floating-mode only */}
      {!isListView && mode === 'bottom' && (
        <div
          onMouseDown={() => handleResizeStart('bottom')}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            cursor: 'row-resize',
            zIndex: 50,
          }}
        />
      )}
      {!isListView && mode === 'right' && (
        <div
          onMouseDown={() => handleResizeStart('right')}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: 6,
            cursor: 'col-resize',
            zIndex: 50,
          }}
        />
      )}
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            letterSpacing: '0.05em',
          }}
        >
          ■ {t('chat.title')}
        </span>

        {!isListView && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {/* Mode toggle buttons */}
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                title={t(MODE_I18N[m])}
                style={{
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: mode === m ? 'rgba(88, 166, 255, 0.15)' : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: mode === m ? 'var(--accent-blue)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  opacity: mode === m ? 1 : 0.6,
                }}
              >
                <ModeIcon mode={m} />
              </button>
            ))}

            <div style={{ width: 1, height: 16, background: 'var(--border-color)', margin: '0 6px' }} />

            {/* Collapse button (minimize) */}
            <button
              onClick={onToggle}
              title={t('terminal.collapse')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 12,
                padding: '2px 6px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              ▼
            </button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <TerminalTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onAdd={openLocalPicker}
        onClose={closeTab}
        onRename={handleRenameTab}
      />

      {/* SSH preset management dialog */}
      <SSHPresetDialog
        open={sshDialogOpen}
        presets={presets}
        onClose={() => setSshDialogOpen(false)}
        onSave={handleSavePreset}
        onDelete={handleDeletePreset}
        onLaunch={launchPreset}
      />

      {/* CWD Picker overlay */}
      {cwdPickerOpen && createPortal(
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.6)',
          }}
          onClick={() => setCwdPickerOpen(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setCwdPickerOpen(false); }}
        >
          <div
            style={{
              width: 'min(640px, 92vw)',
              maxHeight: 'min(92vh, 800px)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 12,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Picker header with close button */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: '1px solid var(--border-color)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}
            >
              <span style={{ flex: 1 }}>{t('terminal.selectWorkingDir')}</span>
              <button
                onClick={() => setCwdPickerOpen(false)}
                title={t('terminal.closeDialog')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: '2px 6px',
                  opacity: 0.7,
                }}
              >
                ✕
              </button>
            </div>

            {/* SSH quick access — always visible so users can pivot without being trapped */}
            <div style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('terminal.menu.sshPresets')}
              </div>
              {presets.length > 0 && (
                <div style={{ overflowY: 'auto', maxHeight: 200 }}>
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        setCwdPickerOpen(false);
                        launchPreset(preset);
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 16px',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s ease',
                        color: 'var(--text-primary)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(188, 140, 255, 0.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ fontSize: 12, color: 'var(--accent-purple)' }}>🔗</span>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{preset.label}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  setCwdPickerOpen(false);
                  setSshDialogOpen(true);
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px 10px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s ease',
                  color: 'var(--accent-purple)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(188, 140, 255, 0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontSize: 12 }}>➕</span>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{t('terminal.menu.manageSsh')}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.5, color: 'var(--text-secondary)' }}>→</span>
              </button>
            </div>

            {/* Local folder section label */}
            <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: uniquePaths.length > 0 ? 'none' : undefined }}>
              {t('terminal.menu.localFolder')}
            </div>

            {/* Active project shortcuts */}
            {uniquePaths.length > 0 && (
              <div style={{ borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t('agents.projects')}
                </div>
                <div style={{ overflowY: 'auto', maxHeight: 180 }}>
                  {uniquePaths.map((cwd) => (
                    <button
                      key={cwd}
                      onClick={() => handlePickCwd(cwd)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 16px',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s ease',
                        color: 'var(--text-primary)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ fontSize: 12, opacity: 0.6 }}>&#9733;</span>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{pathBasename(cwd)}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.4, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>{cwd}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Previous Claude sessions for current folder */}
            {(pastSessions.length > 0 || pastSessionsLoading) && (
              <div style={{ borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t('terminal.menu.previousSessions')}
                </div>
                {pastSessionsLoading ? (
                  <div style={{ padding: '8px 16px 10px', fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6 }}>…</div>
                ) : (
                  <div style={{ overflowY: 'auto', maxHeight: 180 }}>
                    {pastSessions.slice(0, 20).map((session) => {
                      const timeAgo = formatRelativeTime(session.lastActivity);
                      const preview = session.preview || t('terminal.menu.sessionNoPreview');
                      return (
                        <button
                          key={session.sessionId}
                          onClick={() => handleResumeSession(session)}
                          title={`${session.sessionId}\n${preview}`}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '7px 16px',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'background 0.15s ease',
                            color: 'var(--text-primary)',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(63, 185, 80, 0.08)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <span style={{ fontSize: 12, color: 'var(--accent-green)' }}>⟲</span>
                          <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {preview}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.5, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                            {timeAgo}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Folder browser */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {/* Current path bar + select button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border-color)' }}>
                {browseCurrentPath !== '/' && (
                  <button
                    onClick={() => {
                      const parent = browseCurrentPath.replace(/\/[^/]+\/?$/, '') || '/';
                      fetchBrowse(parent);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: 14,
                      padding: '2px 6px',
                      flexShrink: 0,
                    }}
                    title="Parent directory"
                  >
                    &#8592;
                  </button>
                )}
                <div style={{
                  flex: 1,
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  direction: 'rtl',
                  textAlign: 'left',
                }}>
                  <span dir="ltr">{browseCurrentPath}</span>
                </div>
                <button
                  onClick={() => handlePickCwd(browseCurrentPath)}
                  style={{
                    padding: '4px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'var(--accent-blue)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {t('terminal.selectHere')}
                </button>
              </div>

              {/* Directory listing */}
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, maxHeight: 320 }}>
                {browseLoading ? (
                  <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>...</div>
                ) : browseDirs.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)', opacity: 0.5 }}>
                    {t('terminal.emptyDir')}
                  </div>
                ) : (
                  browseDirs.map((dir) => (
                    <button
                      key={dir.path}
                      onClick={() => fetchBrowse(dir.path)}
                      onDoubleClick={() => handlePickCwd(dir.path)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 16px',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s ease',
                        color: 'var(--text-primary)',
                        fontSize: 12,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ opacity: 0.5, fontSize: 11 }}>&#128193;</span>
                      <span>{dir.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Manual path input */}
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-color)' }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const val = customPath.trim();
                  if (val) handlePickCwd(val);
                }}
              >
                <input
                  type="text"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  placeholder={t('terminal.customPathPlaceholder')}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    outline: 'none',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = 'var(--accent-blue)'; }}
                  onBlur={(e) => { e.target.style.borderColor = 'var(--border-color)'; }}
                />
              </form>
            </div>

            {/* Skip permissions toggle */}
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-color)' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  fontSize: 11,
                  color: skipPermissions ? 'var(--accent-orange, #d29922)' : 'var(--text-secondary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={skipPermissions}
                  onChange={(e) => setSkipPermissions(e.target.checked)}
                  style={{ accentColor: 'var(--accent-orange, #d29922)' }}
                />
                {t('terminal.skipPermissions')}
              </label>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Terminal containers wrapper */}
      <div
        ref={wrapperRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
        }}
      />
    </div>
    </>
  );

  return tree;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WSClientMessage, WSServerMessage } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../App.tsx';
import { MobileSessionList, type MobileSession } from './MobileSessionList.tsx';
import { MobileTerminal } from './MobileTerminal.tsx';
import { MobileSpawnPicker, type MobileSpawnOptions } from './MobileSpawnPicker.tsx';
import { createTermFeed, type TermFeed } from './termFeed.ts';
import { projectName } from '../views/tickets/ticketDisplay.ts';
import { makeTabId } from '../views/chat/tabId.ts';
import { mergeSessions, type TerminalRow } from './mobileSessionMerge.ts';
import { rememberProject } from './recentProjects.ts';
import { autoStartCommand } from './terminalPresets.ts';
import type { MobileProject } from './types.ts';
import type { RemoteTerminalLevel } from './capabilities.ts';
import { primaryButton, actionBar } from './styles.ts';
import { useTranslation } from 'react-i18next';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

/** How often the session list is refetched. */
const POLL_MS = 4000;

export interface MobileSessionsProps {
  subscribeRaw: RawMessageSubscribe;
  send: (msg: WSClientMessage) => void;
  terminalLevel: RemoteTerminalLevel;
  /** Where a phone-started shell may run; only used at the `shell` level. */
  projects: MobileProject[];
  /** Live socket state. A false→true edge means every attach has to be redone. */
  connected: boolean;
}

interface TreeSession {
  sessionId: string;
  providerSessionId?: string;
  title?: string;
  state?: string;
  pendingApprovals?: number;
  lastActiveAt?: number;
}

interface TreeWorkspace {
  workspace?: { rootPath?: string; displayName?: string };
  sessions?: TreeSession[];
}

interface Tree {
  locations?: Array<{ workspaces?: TreeWorkspace[] }>;
}

/** Flatten locations → workspaces → sessions, carrying the workspace path down. */
export function flattenTree(tree: Tree): MobileSession[] {
  const out: MobileSession[] = [];
  for (const location of tree.locations ?? []) {
    for (const workspace of location.workspaces ?? []) {
      const cwd = workspace.workspace?.rootPath ?? '';
      for (const session of workspace.sessions ?? []) {
        out.push({
          sessionId: session.sessionId,
          ...(session.providerSessionId ? { providerSessionId: session.providerSessionId } : {}),
          displayName: session.title ?? '',
          state: session.state ?? 'unknown',
          cwd,
          lastActivityAt: session.lastActiveAt ?? 0,
          needsApproval: (session.pendingApprovals ?? 0) > 0,
        });
      }
    }
  }
  return out;
}

/**
 * The sessions half of the phone app: what is running on this machine, and its
 * terminal.
 *
 * The ptys were always owned by the server, but the *list* of them lived only
 * in the browser that opened them — so a phone could not see a desktop's
 * terminals and opened a parallel set of its own, with ids in a different
 * namespace. The server now publishes its terminal index and the phone mints
 * the same kind of tab id, so both devices are looking at one set.
 *
 * A pty has one grid shared by every viewer, so the phone fits the grid to its
 * screen only for terminals it started itself (`origin: 'mobile'`). Fitting a
 * desktop's terminal would reflow the desktop's window.
 */
export function MobileSessions({ subscribeRaw, send, terminalLevel, projects, connected }: MobileSessionsProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<MobileSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<MobileSession | null>(null);
  const [attachedTab, setAttachedTab] = useState<string | null>(null);
  // A fresh feed per opened terminal: the xterm resets when it changes.
  const [feed, setFeed] = useState<TermFeed>(() => createTermFeed());
  const [hasOutput, setHasOutput] = useState(false);
  const clearOutput = useCallback(() => {
    setFeed(createTermFeed());
    setHasOutput(false);
  }, []);
  const [exited, setExited] = useState(false);
  const [picking, setPicking] = useState(false);
  /** Set once per spawn; typed as soon as the shell produces a prompt. */
  const autoStartRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [treeRes, termRes] = await Promise.all([
        fetch(`${API_BASE}/api/v2/workspace-tree`).catch(() => null),
        // Older servers have no terminal index; the catalog alone still works.
        fetch(`${API_BASE}/api/terminals`).catch(() => null),
      ]);
      const catalog = treeRes?.ok ? flattenTree((await treeRes.json()) as Tree) : [];
      const terminals = termRes?.ok
        ? (((await termRes.json()) as { terminals?: TerminalRow[] }).terminals ?? [])
        : [];
      if (!treeRes?.ok && !termRes?.ok) return;
      setSessions(mergeSessions(catalog, terminals));
    } catch {
      /* offline; the next tick retries */
    } finally {
      setLoading(false);
    }
  }, []);

  // The catalog is fetched rather than pushed: `v2:catalog-changed` carries no
  // payload, so one poll covers both that signal and a dropped socket.
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  // Terminal frames ride the shared socket; only this tab's are ours.
  useEffect(() => {
    if (!attachedTab) return;
    return subscribeRaw((msg: WSServerMessage) => {
      if (msg.type === 'terminal:output' && msg.tabId === attachedTab) {
        feed.push({ kind: 'data', data: msg.data });
        setHasOutput(true);
        // The shell is up and talking: type the preset the user asked for.
        const command = autoStartRef.current;
        if (command) {
          autoStartRef.current = null;
          send({ type: 'terminal:input', tabId: attachedTab, data: `${command}\r` });
        }
      } else if (msg.type === 'terminal:restore' && msg.tabId === attachedTab) {
        // A replay is the whole scrollback: start from a clean screen. It also
        // proves the pty is alive, which is the only way out of `exited` after
        // a dropped socket reported it missing.
        feed.push({ kind: 'reset' });
        feed.push({ kind: 'data', data: msg.data });
        if (msg.data) setHasOutput(true);
        setExited(false);
      } else if (msg.type === 'terminal:size' && msg.tabId === attachedTab) {
        feed.push({ kind: 'size', cols: msg.cols, rows: msg.rows });
      } else if (msg.type === 'terminal:exited' && msg.tabId === attachedTab) {
        setExited(true);
      } else if ((msg.type === 'terminal:dormant' || msg.type === 'terminal:missing') && msg.tabId === attachedTab) {
        setExited(true);
      }
    });
  }, [attachedTab, subscribeRaw, feed, send]);

  /**
   * Re-attach after the socket comes back, and after the app returns to the
   * foreground.
   *
   * Backgrounding a phone browser closes the WebSocket within seconds. The pty
   * keeps running — the server owns it — but this client is no longer a
   * subscriber, so nothing arrives and the last thing it heard was "missing".
   * That is the whole of "this terminal has ended": a live session behind a
   * stale subscription. Re-attaching is the fix; the server replies with the
   * scrollback and the handler above clears `exited`.
   */
  const reattach = useCallback(() => {
    if (!attachedTab) return;
    clearOutput();
    send({ type: 'terminal:attach', tabId: attachedTab });
    void reload();
  }, [attachedTab, send, clearOutput, reload]);

  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) reattach();
    wasConnected.current = connected;
  }, [connected, reattach]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reattach();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reattach]);

  /** Open a session straight into its pty. */
  const openSession = useCallback(async (session: MobileSession) => {
    setOpen(session);
    clearOutput();
    setExited(false);
    setAttachedTab(null);
    autoStartRef.current = null;

    // The merged list already knows the tab for most rows; only a catalog-only
    // row still needs the lookup.
    if (session.tabId) {
      setAttachedTab(session.tabId);
      send({ type: 'terminal:attach', tabId: session.tabId });
      if (session.terminalLive === false) setExited(true);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/v2/sessions/${encodeURIComponent(session.sessionId)}/terminal`);
      const data = res.ok ? ((await res.json()) as { live?: boolean; tabId?: string }) : null;
      if (data?.tabId) {
        setAttachedTab(data.tabId);
        send({ type: 'terminal:attach', tabId: data.tabId });
        if (!data.live) setExited(true);
      } else {
        setExited(true);
      }
    } catch {
      setExited(true);
    }
  }, [send, clearOutput]);

  /**
   * Start a shell from the phone.
   *
   * The tab id comes from the same generator the desktop uses, so the terminal
   * appears in the desktop's index too rather than in a `phone-*` namespace of
   * its own. `origin: 'mobile'` records that this device may size the grid;
   * the size itself is reported by the pane once it has measured.
   */
  const spawn = useCallback((cwd: string, options: MobileSpawnOptions) => {
    const tabId = makeTabId();
    setPicking(false);
    clearOutput();
    setExited(false);
    rememberProject({ path: cwd, name: projectName(cwd) });
    autoStartRef.current = options.autoStart ? autoStartCommand() : null;
    setOpen({
      sessionId: tabId, displayName: projectName(cwd), state: 'running', cwd,
      lastActivityAt: Date.now(), needsApproval: false, tabId, origin: 'mobile', terminalLive: true,
    });
    setAttachedTab(tabId);
    send({ type: 'terminal:spawn', tabId, cwd, mode: 'shell', source: 'local', origin: 'mobile' });
  }, [send, clearOutput]);

  const close = () => { setOpen(null); setAttachedTab(null); clearOutput(); };

  const canType = attachedTab !== null && (terminalLevel === 'input' || terminalLevel === 'shell');

  if (open) {
    return (
      <MobileTerminal
        title={projectName(open.cwd) || open.displayName || open.sessionId.slice(0, 12)}
        subtitle={open.displayName}
        feed={feed}
        hasOutput={hasOutput}
        canType={canType}
        exited={exited}
        // Only our own pty may be reshaped; a desktop's grid is not ours to change.
        owned={open.origin === 'mobile'}
        lastActivityAt={open.lastActivityAt}
        onBack={close}
        onSend={(data) => attachedTab && send({ type: 'terminal:input', tabId: attachedTab, data })}
        onKey={(sequence) => attachedTab && send({ type: 'terminal:input', tabId: attachedTab, data: sequence })}
        {...(open.origin === 'mobile' && canType
          ? { onFit: (cols: number, rows: number) => attachedTab && send({ type: 'terminal:resize', tabId: attachedTab, cols, rows }) }
          : {})}
        onRefresh={attachedTab ? reattach : undefined}
      />
    );
  }

  if (picking) {
    return <MobileSpawnPicker projects={projects} onCancel={() => setPicking(false)} onSpawn={spawn} />;
  }

  return (
    <>
      <MobileSessionList
        sessions={sessions}
        loading={loading}
        onOpen={(id) => {
          const session = sessions.find((s) => s.sessionId === id);
          if (session) void openSession(session);
        }}
        onRefresh={reload}
      />
      {terminalLevel === 'shell' && (
        <div style={actionBar}>
          <button style={primaryButton} onClick={() => setPicking(true)}>{t('mobile.terminalNew')}</button>
        </div>
      )}
    </>
  );
}

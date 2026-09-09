import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WSClientMessage, WSServerMessage } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../App.tsx';
import { MobileSessionList, type MobileSession } from './MobileSessionList.tsx';
import { MobileSessionDetail, type ConversationEntry } from './MobileSessionDetail.tsx';
import { MobileTerminal } from './MobileTerminal.tsx';
import { appendOutput } from './ansi.ts';
import { MobileSpawnPicker } from './MobileSpawnPicker.tsx';
import type { MobileProject } from './types.ts';
import type { RemoteTerminalLevel } from './capabilities.ts';
import { primaryButton, actionBar } from './styles.ts';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

/** How often the session list and the open conversation are refetched. */
const POLL_MS = 4000;
/** The catalog holds every session this machine has ever run; a phone wants the live end of it. */
const MAX_ROWS = 60;

export interface MobileSessionsProps {
  subscribeRaw: RawMessageSubscribe;
  send: (msg: WSClientMessage) => void;
  terminalLevel: RemoteTerminalLevel;
  /** Where a phone-started shell may run; only used at the `shell` level. */
  projects: MobileProject[];
}

interface TreeSession {
  sessionId: string;
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
 * The sessions half of the phone app: what is running on this machine, what it
 * said, and — where the server permits it — its terminal.
 */
export function MobileSessions({ subscribeRaw, send, terminalLevel, projects }: MobileSessionsProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<MobileSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<ConversationEntry[]>([]);
  const [terminalTabId, setTerminalTabId] = useState<string | null>(null);
  const [attachedTab, setAttachedTab] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [exited, setExited] = useState(false);
  const [picking, setPicking] = useState(false);

  // The catalog is fetched rather than pushed: `v2:catalog-changed` carries no
  // payload, so one poll covers both that signal and a dropped socket.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v2/workspace-tree`);
        if (!res.ok) return;
        const tree = (await res.json()) as Tree;
        if (!stop) setSessions(flattenTree(tree));
      } catch {
        /* offline; the next tick retries */
      } finally {
        if (!stop) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => { stop = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!openId) return;
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v2/sessions/${encodeURIComponent(openId)}/conversation?cursor=0`);
        if (!res.ok) return;
        const data = (await res.json()) as { items?: ConversationEntry[] };
        if (!stop) setItems(data.items ?? []);
      } catch {
        /* offline; the next tick retries */
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => { stop = true; clearInterval(timer); };
  }, [openId]);

  // Whether this session has a pty Alive owns. One call per opened session —
  // the catalog does not carry it, and asking for all 600 would be absurd.
  useEffect(() => {
    if (!openId || terminalLevel === 'off') {
      setTerminalTabId(null);
      return;
    }
    let stop = false;
    fetch(`${API_BASE}/api/v2/sessions/${encodeURIComponent(openId)}/terminal`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { live?: boolean; tabId?: string } | null) => {
        if (!stop) setTerminalTabId(data?.live && data.tabId ? data.tabId : null);
      })
      .catch(() => {
        /* treated as "no terminal" */
      });
    return () => { stop = true; };
  }, [openId, terminalLevel]);

  // Terminal frames ride the shared socket; only this tab's are ours.
  useEffect(() => {
    if (!attachedTab) return;
    return subscribeRaw((msg: WSServerMessage) => {
      if (msg.type === 'terminal:output' && msg.tabId === attachedTab) {
        setOutput((prev) => appendOutput(prev, msg.data));
      } else if (msg.type === 'terminal:restore' && msg.tabId === attachedTab) {
        setOutput(appendOutput('', msg.data));
      } else if (msg.type === 'terminal:exited' && msg.tabId === attachedTab) {
        setExited(true);
      } else if ((msg.type === 'terminal:dormant' || msg.type === 'terminal:missing') && msg.tabId === attachedTab) {
        setExited(true);
      }
    });
  }, [attachedTab, subscribeRaw]);

  const openTerminal = useCallback(() => {
    if (!terminalTabId) return;
    setOutput('');
    setExited(false);
    setAttachedTab(terminalTabId);
    send({ type: 'terminal:attach', tabId: terminalTabId });
  }, [terminalTabId, send]);

  /**
   * Start a shell from the phone. Sized 60x24 rather than inherited: the pty
   * wraps to the columns it is told about, and a phone reading 80-column output
   * is a wall of broken lines.
   */
  const spawn = useCallback((cwd: string) => {
    const tabId = `phone-${Date.now().toString(36)}`;
    setPicking(false);
    setOutput('');
    setExited(false);
    setAttachedTab(tabId);
    send({ type: 'terminal:spawn', tabId, cwd, mode: 'shell', source: 'local' });
    send({ type: 'terminal:resize', tabId, cols: 60, rows: 24 });
  }, [send]);

  const rows = useMemo(() => sessions.slice(0, MAX_ROWS), [sessions]);
  const open = useMemo(() => sessions.find((s) => s.sessionId === openId) ?? null, [sessions, openId]);

  if (attachedTab) {
    return (
      <MobileTerminal
        title={open?.displayName || attachedTab.slice(0, 10)}
        output={output}
        canType={terminalLevel === 'input' || terminalLevel === 'shell'}
        exited={exited}
        onBack={() => { setAttachedTab(null); setOutput(''); }}
        onSend={(data) => send({ type: 'terminal:input', tabId: attachedTab, data })}
        onKey={(sequence) => send({ type: 'terminal:input', tabId: attachedTab, data: sequence })}
      />
    );
  }

  if (open) {
    return (
      <MobileSessionDetail
        title={open.displayName || open.sessionId.slice(0, 12)}
        items={items}
        onBack={() => { setOpenId(null); setItems([]); }}
        canOpenTerminal={terminalTabId !== null}
        onOpenTerminal={openTerminal}
      />
    );
  }

  if (picking) {
    return <MobileSpawnPicker projects={projects} onCancel={() => setPicking(false)} onSpawn={spawn} />;
  }

  return (
    <>
      <MobileSessionList sessions={rows} loading={loading} onOpen={setOpenId} />
      {terminalLevel === 'shell' && (
        <div style={actionBar}>
          <button style={primaryButton} onClick={() => setPicking(true)}>{t('mobile.terminalNew')}</button>
        </div>
      )}
    </>
  );
}

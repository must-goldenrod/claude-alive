import { useCallback, useEffect, useState } from 'react';
import type { WSClientMessage, WSServerMessage } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../App.tsx';
import { MobileSessionList, type MobileSession } from './MobileSessionList.tsx';
import { MobileTerminal } from './MobileTerminal.tsx';
import { MobileSpawnPicker } from './MobileSpawnPicker.tsx';
import { appendOutput } from './ansi.ts';
import { projectName } from '../views/tickets/ticketDisplay.ts';
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
 * The sessions half of the phone app: what is running on this machine, and its
 * terminal.
 *
 * Tapping a session opens the pty directly. The structured conversation was in
 * between for a while, but it is a second copy of what the terminal already
 * shows and a phone has room for one of them — and only the terminal can be
 * answered.
 */
export function MobileSessions({ subscribeRaw, send, terminalLevel, projects }: MobileSessionsProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<MobileSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<MobileSession | null>(null);
  const [attachedTab, setAttachedTab] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [exited, setExited] = useState(false);
  const [picking, setPicking] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v2/workspace-tree`);
      if (!res.ok) return;
      setSessions(flattenTree((await res.json()) as Tree));
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

  /** Open a session straight into its pty; a session Alive never spawned has none. */
  const openSession = useCallback(async (session: MobileSession) => {
    setOpen(session);
    setOutput('');
    setExited(false);
    setAttachedTab(null);
    try {
      const res = await fetch(`${API_BASE}/api/v2/sessions/${encodeURIComponent(session.sessionId)}/terminal`);
      const data = res.ok ? ((await res.json()) as { live?: boolean; tabId?: string }) : null;
      if (data?.live && data.tabId) {
        setAttachedTab(data.tabId);
        send({ type: 'terminal:attach', tabId: data.tabId });
      } else {
        setExited(true);
      }
    } catch {
      setExited(true);
    }
  }, [send]);

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
    setOpen({ sessionId: tabId, displayName: projectName(cwd), state: 'running', cwd, lastActivityAt: Date.now(), needsApproval: false });
    setAttachedTab(tabId);
    send({ type: 'terminal:spawn', tabId, cwd, mode: 'shell', source: 'local' });
    send({ type: 'terminal:resize', tabId, cols: 60, rows: 24 });
  }, [send]);

  const close = () => { setOpen(null); setAttachedTab(null); setOutput(''); };

  if (open) {
    return (
      <MobileTerminal
        title={open.displayName || open.sessionId.slice(0, 12)}
        subtitle={projectName(open.cwd)}
        output={output}
        canType={attachedTab !== null && (terminalLevel === 'input' || terminalLevel === 'shell')}
        exited={exited}
        onBack={close}
        onSend={(data) => attachedTab && send({ type: 'terminal:input', tabId: attachedTab, data })}
        onKey={(sequence) => attachedTab && send({ type: 'terminal:input', tabId: attachedTab, data: sequence })}
        onRefresh={attachedTab ? () => { setOutput(''); send({ type: 'terminal:attach', tabId: attachedTab }); } : undefined}
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

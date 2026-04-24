import { Component, lazy, Suspense, useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { ReactNode, MutableRefObject } from 'react';
import type { WSServerMessage } from '@claude-alive/core';
import i18n from '@claude-alive/i18n';
import { HeaderBar } from './components/HeaderBar.tsx';
import { useWebSocket } from './views/dashboard/hooks/useWebSocket.ts';
import { ChatOverlay } from './views/chat/ChatOverlay.tsx';
import type { TerminalEventHandler, SshSessionInfo } from './views/chat/ChatOverlay.tsx';
import { ToastContainer, useToasts } from './components/ToastContainer.tsx';

const PixelOfficePage = lazy(() =>
  import('./views/pixel/PixelOfficePage.tsx').then(m => ({ default: m.PixelOfficePage })),
);

const AgentListView = lazy(() =>
  import('./views/list/AgentListView.tsx').then(m => ({ default: m.AgentListView })),
);

export type ViewMode = 'animation' | 'list';

export type RawMessageSubscribe = (handler: (msg: WSServerMessage) => void) => () => void;

const WS_URL = `ws://${window.location.hostname}:${window.location.port || '3141'}/ws`;
const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state: { hasError: boolean; error: Error | null } = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[claude-alive] UI error:', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: '#e5534b', fontFamily: 'monospace', textAlign: 'center' }}>
          <p>{i18n.t('error.somethingWentWrong')}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 12, padding: '6px 16px', cursor: 'pointer' }}
          >
            {i18n.t('error.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('animation');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  // SSH tab presence — mirrored from ChatOverlay so the sidebar can show active SSH sessions.
  // We can't track what's happening inside the remote shell (hooks are local-only) but we
  // can at least show that a session is open and whether it's producing output.
  const [sshSessions, setSshSessions] = useState<SshSessionInfo[]>([]);
  const handleSshSessionsChange = useCallback((sessions: SshSessionInfo[]) => {
    setSshSessions(sessions);
  }, []);

  const { toasts, addToast, dismissToast } = useToasts();
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;

  // View-level raw message subscribers (e.g. PixelOfficePage registers its office-state handler)
  const rawSubscribersRef = useRef<Set<(msg: WSServerMessage) => void>>(new Set());
  const terminalHandlerRef: MutableRefObject<TerminalEventHandler | null> = useRef<TerminalEventHandler | null>(null);

  // Snapshot of agents for label lookup in toasts (avoids useWebSocket callback identity churn)
  const agentsSnapshotRef = useRef<Map<string, { displayName: string | null }>>(new Map());

  // Project names (cwd → name) — single source of truth for project labels across sidebar/tabs/CLI.
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});

  // Initial fetch + refetch on WS reconnect. WS broadcasts (project:names) keep us in sync afterwards.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/projects/names`)
      .then((r) => r.json())
      .then((data: { names?: Record<string, string> }) => {
        if (!cancelled && data.names) setProjectNames(data.names);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const stableOnRaw = useCallback((msg: WSServerMessage) => {
    // App-level dispatch: terminal pipe + global toasts
    if (msg.type === 'terminal:output' || msg.type === 'terminal:exited') {
      terminalHandlerRef.current?.(msg);
    }
    if (msg.type === 'project:names') {
      setProjectNames(msg.names);
    }
    if (msg.type === 'agent:state') {
      const label = agentsSnapshotRef.current.get(msg.sessionId)?.displayName || msg.sessionId.slice(0, 8);
      if (msg.state === 'waiting') {
        addToastRef.current('warning', label, 'notifications.needsPermission', `${msg.sessionId}:waiting`);
      } else if (msg.state === 'error') {
        addToastRef.current('error', label, 'notifications.errorOccurred', `${msg.sessionId}:error`);
      }
    }
    // Fan out to view-level subscribers
    for (const sub of rawSubscribersRef.current) {
      sub(msg);
    }
  }, []);

  const { agents, events, completedSessions, stats, systemMetrics, send } = useWebSocket(WS_URL, stableOnRaw);

  // Keep the snapshot ref in sync for the toast-label lookup
  agentsSnapshotRef.current = useMemo(() => {
    const m = new Map<string, { displayName: string | null }>();
    for (const [sid, a] of agents) m.set(sid, { displayName: a.displayName });
    return m;
  }, [agents]);

  const subscribeRaw: RawMessageSubscribe = useCallback((handler) => {
    rawSubscribersRef.current.add(handler);
    return () => { rawSubscribersRef.current.delete(handler); };
  }, []);

  const handleTerminalSpawn = useCallback(
    (req: {
      tabId: string;
      cwd?: string;
      skipPermissions?: boolean;
      mode: 'claude' | 'shell';
      source: 'local' | 'ssh';
      initialCommand?: string;
      claudeSessionId?: string;
      resumeSessionId?: string;
      displayName?: string;
    }) => {
      send({
        type: 'terminal:spawn',
        tabId: req.tabId,
        cwd: req.cwd,
        skipPermissions: req.skipPermissions,
        mode: req.mode,
        source: req.source,
        initialCommand: req.initialCommand,
        claudeSessionId: req.claudeSessionId,
        resumeSessionId: req.resumeSessionId,
        displayName: req.displayName,
      });
    },
    [send],
  );

  const handleTerminalInput = useCallback((tabId: string, data: string) => {
    send({ type: 'terminal:input', tabId, data });
  }, [send]);

  const handleTerminalResize = useCallback((tabId: string, cols: number, rows: number) => {
    send({ type: 'terminal:resize', tabId, cols, rows });
  }, [send]);

  const handleTerminalClose = useCallback((tabId: string) => {
    send({ type: 'terminal:close', tabId });
  }, [send]);

  /** Save or clear a project name for a cwd. Server broadcasts the new map back over WS. */
  const handleProjectNameChange = useCallback((cwd: string, name: string | null) => {
    fetch(`${API_BASE}/api/projects/names`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, name }),
    }).catch(() => {});
  }, []);

  const agentList = useMemo(() => Array.from(agents.values()), [agents]);
  const projectPaths = useMemo(() => [...new Set(agentList.map(a => a.cwd))], [agentList]);

  // In List view, terminal is always visible. In Animation view, follow chatOpen.
  const chatEffectivelyOpen = viewMode === 'list' ? true : chatOpen;
  // Left inset for the list-view terminal layout: matches the ProjectSidebar width when open.
  // Keep in sync with ProjectSidebar's own width (300px in its component).
  const SIDEBAR_WIDTH = 300;
  const listLeftInset = leftPanelOpen ? SIDEBAR_WIDTH : 0;

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <HeaderBar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        leftPanelOpen={leftPanelOpen}
        rightPanelOpen={rightPanelOpen}
        chatOpen={chatOpen}
        onToggleLeftPanel={() => setLeftPanelOpen(prev => !prev)}
        onToggleRightPanel={() => setRightPanelOpen(prev => !prev)}
        onToggleChat={() => setChatOpen(prev => !prev)}
        systemMetrics={systemMetrics}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', marginTop: 56, position: 'relative' }}>
        <ErrorBoundary>
          {/* Both views stay mounted. Only CSS display toggles — preserves game state, selected agent, list scroll, etc. */}
          <div style={{ position: 'absolute', inset: 0, display: viewMode === 'animation' ? 'block' : 'none' }}>
            <Suspense fallback={null}>
              <PixelOfficePage
                active={viewMode === 'animation'}
                agents={agents}
                events={events}
                completedSessions={completedSessions}
                stats={stats}
                subscribeRaw={subscribeRaw}
                leftPanelOpen={leftPanelOpen}
                rightPanelOpen={rightPanelOpen}
                sshSessions={sshSessions}
                projectNames={projectNames}
                onProjectNameChange={handleProjectNameChange}
              />
            </Suspense>
          </div>
          <div style={{ position: 'absolute', inset: 0, display: viewMode === 'list' ? 'block' : 'none' }}>
            <Suspense fallback={null}>
              <AgentListView
                agents={agentList}
                leftPanelOpen={leftPanelOpen}
                sshSessions={sshSessions}
                projectNames={projectNames}
                onProjectNameChange={handleProjectNameChange}
              />
            </Suspense>
          </div>
        </ErrorBoundary>

        {/* App-level ChatOverlay — the DOM never relocates. When viewMode switches, the
            overlay animates between its floating-mode coordinates and the list-view layout
            via CSS transitions (see OVERLAY_TRANSITION in ChatOverlay). xterm scrollback
            and server pty stay alive because the component is always mounted here. */}
        <ChatOverlay
          open={chatEffectivelyOpen}
          onToggle={() => setChatOpen(prev => !prev)}
          onSpawn={handleTerminalSpawn}
          onInput={handleTerminalInput}
          onResize={handleTerminalResize}
          onClose={handleTerminalClose}
          terminalEventRef={terminalHandlerRef}
          projectPaths={projectPaths}
          listViewActive={viewMode === 'list'}
          listLeftInset={listLeftInset}
          onSshSessionsChange={handleSshSessionsChange}
          projectNames={projectNames}
        />
      </div>
    </div>
  );
}

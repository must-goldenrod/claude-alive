import { Component, lazy, Suspense, useState, useRef, useCallback, useMemo, useEffect, useReducer } from 'react';
import type { ReactNode, MutableRefObject } from 'react';
import type { WSServerMessage } from '@claude-alive/core';
import i18n from '@claude-alive/i18n';
import { HeaderBar } from './components/HeaderBar.tsx';
import { normalizeViewMode } from './components/viewGroups.ts';
import { useWebSocket } from './views/dashboard/hooks/useWebSocket.ts';
import { playErrorSound, playResourceAlertSound, playWaitingSound, installAudioUnlock } from './services/sound.ts';
import { ChatOverlay } from './views/chat/ChatOverlay.tsx';
import type { TerminalEventHandler, SshSessionInfo } from './views/chat/ChatOverlay.tsx';
import { RepoSidebar } from './components/RepoSidebar/RepoSidebar.tsx';
import { useRunTree } from './hooks/useRunTree.ts';
import { loadSelection, saveSelection, selectionReducer } from './state/selection.ts';
import { ToastContainer, useToasts } from './components/ToastContainer.tsx';
import { fireNotification } from './services/notifications.ts';
import { buildAlertContent } from './services/notificationContent.ts';
import type { AlertContext, AlertKind } from './services/notificationContent.ts';
import { SettingsModal } from './components/SettingsModal.tsx';
import { ResourceAlert, type ResourceAlertData } from './components/ResourceAlert.tsx';
import { BackendAlert, type BackendAlertData } from './components/BackendAlert.tsx';
import { checkBackendHealth } from './services/backendHealth.ts';
import { getSettings } from './services/settings.ts';

const PixelOfficePage = lazy(() =>
  import('./views/pixel/PixelOfficePage.tsx').then(m => ({ default: m.PixelOfficePage })),
);

const AgentListView = lazy(() =>
  import('./views/list/AgentListView.tsx').then(m => ({ default: m.AgentListView })),
);

const TicketsView = lazy(() =>
  import('./views/tickets/TicketsView.tsx').then(m => ({ default: m.TicketsView })),
);
import { WorkspaceTreeView } from './views/workspace/WorkspaceTreeView';
import { BoardView } from './views/board/BoardView.tsx';

export type ViewMode = 'animation' | 'list' | 'prompt' | 'efficio' | 'archive' | 'ticketMgmt' | 'spread' | 'jarvis' | 'workspace' | 'tickets' | 'data' | 'board';

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
  const [viewMode, setViewMode] = useState<ViewMode>('tickets');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // SSH tab presence — mirrored from ChatOverlay so the sidebar can show active SSH sessions.
  // We can't track what's happening inside the remote shell (hooks are local-only) but we
  // can at least show that a session is open and whether it's producing output.
  const [sshSessions, setSshSessions] = useState<SshSessionInfo[]>([]);
  const handleSshSessionsChange = useCallback((sessions: SshSessionInfo[]) => {
    setSshSessions(sessions);
  }, []);
  // Set of Claude sessionIds currently open as tabs in the in-app chat. Sidebar
  // uses this to mark every other agent as "external", which matches user intuition
  // ("only what's live in the chat right now is internal") instead of the server-side
  // managedSessionIds set, which never forgets a sessionId once spawned.
  const [chatClaudeSessionIds, setChatClaudeSessionIds] = useState<Set<string>>(() => new Set());
  const handleChatClaudeSessionsChange = useCallback((ids: Set<string>) => {
    setChatClaudeSessionIds(ids);
  }, []);

  const { toasts, addToast, dismissToast } = useToasts();
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;

  // View-level raw message subscribers (e.g. PixelOfficePage registers its office-state handler)
  const rawSubscribersRef = useRef<Set<(msg: WSServerMessage) => void>>(new Set());
  const terminalHandlerRef: MutableRefObject<TerminalEventHandler | null> = useRef<TerminalEventHandler | null>(null);

  // Snapshot of agents for notification content lookup (avoids useWebSocket callback identity
  // churn). Carries everything a notification needs to describe the work: which root folder,
  // which prompt, which agent — never the sessionId.
  const agentsSnapshotRef = useRef<Map<string, AlertContext>>(new Map());
  // cwd → user-defined project name, kept in a ref for the same reason.
  const projectNamesRef = useRef<Record<string, string>>({});

  // Last broadcast state per session. Used to fire the decision-request sound only
  // on the *transition* into `waiting`, not on every `waiting` re-broadcast — the
  // FSM keeps an agent in the sticky `waiting` state across later tool events, so
  // firing per-message would ring the chime repeatedly while Claude resumes work.
  const prevStateRef = useRef<Map<string, string>>(new Map());

  // Unlock audio on the first user interaction. Browsers block programmatic
  // playback until the page has a user gesture, so event-driven notification
  // sounds stay silent on a dashboard that's only watched. This primes them.
  useEffect(() => installAudioUnlock(), []);

  // Reload/close guard. An accidental Cmd-R tears down every xterm in the app
  // plus the reconnect epoch, and even with session resume a reload interrupts
  // whatever is live. This guard used to live inside ChatOverlay but was dropped
  // when session persistence landed (commit d206c96 → 5d43fcb), which is why the
  // prompt silently stopped appearing. It now lives at the app root so it fires
  // on ANY refresh/close regardless of the active view, and can't be removed as a
  // side effect of a terminal-only change. The browser shows its native "Leave
  // site?" dialog — per spec the custom message is ignored, so no i18n string is
  // needed. This is unconditional by design: the user must always be asked first.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for legacy browsers; modern ones display a generic message.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

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
    // App-level dispatch: terminal pipe + global toasts.
    // Forward EVERY terminal:* message — the ChatOverlay handler needs
    // restore (scrollback replay), dormant/missing (drives auto-resume after a
    // server restart) and ssh-error too, not just output/exited. Filtering to
    // output/exited here silently killed the dormant→resume path, leaving
    // restored tabs blank after a restart.
    if (msg.type.startsWith('terminal:')) {
      terminalHandlerRef.current?.(msg);
    }
    if (msg.type === 'project:names') {
      setProjectNames(msg.names);
    }
    if (msg.type === 'agent:despawn') {
      prevStateRef.current.delete(msg.sessionId);
    }
    if (msg.type === 'agent:state') {
      const agent = agentsSnapshotRef.current.get(msg.sessionId);
      const prevState = prevStateRef.current.get(msg.sessionId);
      prevStateRef.current.set(msg.sessionId, msg.state);

      /**
       * Describe the transition in terms a reader can act on — root folder, the prompt
       * that started the work, the tool involved — and deliver it as an OS notification.
       * The in-app toast is the fallback for when the native path is unavailable
       * (permission not granted, notifications toggled off, unsupported browser), so the
       * alert is never lost, and the same message never lands twice.
       */
      const notify = (
        kind: AlertKind,
        toastType: 'warning' | 'error' | 'success',
        requireInteraction: boolean,
      ) => {
        const content = buildAlertContent(kind, {
          ...agent,
          // A user-defined project name (set in the sidebar) beats the cwd basename.
          projectName: (agent?.cwd ? projectNamesRef.current[agent.cwd] : undefined) || agent?.projectName,
          tool: msg.type === 'agent:state' ? msg.tool : null,
        });
        const tag = `${msg.sessionId}:${kind}`;
        const fired = fireNotification({
          title: content.title,
          body: content.body,
          tag,
          requireInteraction,
        });
        if (!fired) {
          addToastRef.current(toastType, content, tag);
        }
      };

      if (msg.state === 'waiting') {
        notify('waiting', 'warning', true);
        // Audible cue so a decision request is noticed even when the dashboard
        // is in the background. Fire only on the transition into `waiting` — the
        // state is sticky and re-broadcasts on later tool events, which would
        // otherwise replay the chime while Claude resumes work after the answer.
        if (prevState !== 'waiting') {
          playWaitingSound(msg.sessionId);
        }
      } else if (msg.state === 'error') {
        notify('error', 'error', true);
        playErrorSound(msg.sessionId);
      } else if (
        (msg.state === 'idle' || msg.state === 'done') &&
        (prevState === 'listening' || prevState === 'active' || prevState === 'waiting' || prevState === 'error')
      ) {
        // Completion: a task finished. Mirror the exact transition that fires the
        // completion chime (in useWebSocket) so sound, toast, and native
        // notification always agree on what "done" means. Unlike waiting/error
        // this is informational, so the native notification does not require
        // interaction — it auto-dismisses.
        notify('done', 'success', false);
      }
    }
    // Fan out to view-level subscribers
    for (const sub of rawSubscribersRef.current) {
      sub(msg);
    }
  }, []);

  const { agents, events, completedSessions, stats, systemMetrics, resumableSessions, connected, send } = useWebSocket(WS_URL, stableOnRaw);

  // Resource alert: fires when CPU or memory stays above the configured threshold for
  // `sustainSeconds`. After dismiss we apply a 30s cooldown to avoid spam loops.
  const [resourceAlert, setResourceAlert] = useState<ResourceAlertData | null>(null);
  const breachStartRef = useRef<number | null>(null);
  const lastFiredAtRef = useRef<number>(0);

  useEffect(() => {
    if (!systemMetrics) return;
    const settings = getSettings();
    const { alerts } = settings;
    const cpuPct = systemMetrics.cpu * 100;
    const memPct = systemMetrics.memTotal > 0 ? (systemMetrics.memUsed / systemMetrics.memTotal) * 100 : 0;
    const cpuBreach = alerts.cpu.enabled && cpuPct >= alerts.cpu.thresholdPct;
    const memBreach = alerts.memory.enabled && memPct >= alerts.memory.thresholdPct;

    if (!cpuBreach && !memBreach) {
      breachStartRef.current = null;
      return;
    }
    if (resourceAlert) return;

    const now = Date.now();
    if (breachStartRef.current === null) {
      breachStartRef.current = now;
      return;
    }
    if (now - breachStartRef.current < alerts.sustainSeconds * 1000) return;
    if (now - lastFiredAtRef.current < 30_000) return;

    const kind: ResourceAlertData['kind'] =
      cpuBreach && memBreach ? 'both' : cpuBreach ? 'cpu' : 'memory';
    setResourceAlert({
      kind,
      cpuPct,
      memPct,
      cpuThreshold: alerts.cpu.thresholdPct,
      memThreshold: alerts.memory.thresholdPct,
    });

    const soundEnabled =
      (kind === 'cpu' && alerts.cpu.soundEnabled) ||
      (kind === 'memory' && alerts.memory.soundEnabled) ||
      (kind === 'both' && (alerts.cpu.soundEnabled || alerts.memory.soundEnabled));
    if (soundEnabled) {
      playResourceAlertSound(settings.sound.error.volume);
    }
  }, [systemMetrics, resourceAlert]);

  const handleResourceAlertDismiss = useCallback(() => {
    setResourceAlert(null);
    lastFiredAtRef.current = Date.now();
    breachStartRef.current = null;
  }, []);

  // Backend connection guard. On startup (once), verify the saved backend
  // connections and, if any fail, raise a modal alert mirroring the resource
  // alert. The check honours the persisted `backend.checkOnStartup` /
  // `alertOnFailure` toggles so the previous session's setup carries over.
  const [backendAlert, setBackendAlert] = useState<BackendAlertData | null>(null);
  const [backendRechecking, setBackendRechecking] = useState(false);
  const backendCheckedRef = useRef(false);

  useEffect(() => {
    if (backendCheckedRef.current) return;
    if (!getSettings().backend.checkOnStartup) return;
    backendCheckedRef.current = true;
    let cancelled = false;
    void checkBackendHealth()
      .then((failures) => {
        if (cancelled) return;
        if (failures.length > 0 && getSettings().backend.alertOnFailure) {
          setBackendAlert({ failures });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBackendRecheck = useCallback(() => {
    setBackendRechecking(true);
    void checkBackendHealth()
      .then((failures) => {
        setBackendAlert(failures.length > 0 ? { failures } : null);
      })
      .catch(() => {})
      .finally(() => setBackendRechecking(false));
  }, []);

  // Keep the snapshot ref in sync for notification content lookup
  agentsSnapshotRef.current = useMemo(() => {
    const m = new Map<string, AlertContext>();
    for (const [sid, a] of agents) {
      m.set(sid, {
        displayName: a.displayName,
        cwd: a.cwd,
        projectName: a.projectName,
        lastPrompt: a.lastPrompt,
      });
    }
    return m;
  }, [agents]);

  projectNamesRef.current = projectNames;

  // Set of Claude session IDs currently in the `waiting` state. Recomputed on every agent
  // map change; the identity is stable when nothing changed (empty stays empty), so the
  // downstream effect in ChatOverlay won't re-run spuriously.
  const waitingSessionIds = useMemo(() => {
    const s = new Set<string>();
    for (const [sid, a] of agents) {
      if (a.state === 'waiting') s.add(sid);
    }
    return s;
  }, [agents]);

  // Tab-title heartbeat: when the dashboard tab IS focused (so no OS notification fires)
  // but at least one agent is waiting, flash the document title between the base title
  // and a "❗ N waiting" marker. Restores the base title on cleanup. This is the focused-
  // tab counterpart to the `fireNotification` path that handles unfocused tabs.
  useEffect(() => {
    const waitingCount = waitingSessionIds.size;
    const baseTitle = 'claude-alive';
    if (waitingCount === 0) {
      document.title = baseTitle;
      return;
    }
    const marker = `❗ ${waitingCount} ${i18n.t('notifications.needsPermission')}`;
    let showMarker = true;
    document.title = marker;
    const id = window.setInterval(() => {
      showMarker = !showMarker;
      document.title = showMarker ? marker : baseTitle;
    }, 1200);
    return () => {
      window.clearInterval(id);
      document.title = baseTitle;
    };
  }, [waitingSessionIds]);

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
      claudeVariant?: 'claude' | 'agents';
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
        claudeVariant: req.claudeVariant,
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

  const handleTerminalAttach = useCallback((tabId: string) => {
    send({ type: 'terminal:attach', tabId });
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
  const chatEffectivelyOpen = viewMode === 'list' || viewMode === 'spread' ? true : chatOpen;
  // Left inset for the list-view terminal layout: matches the ProjectSidebar width when open.
  // Keep in sync with ProjectSidebar's own width (300px in its component).
  const SIDEBAR_WIDTH = 300;
  const listLeftInset = leftPanelOpen ? SIDEBAR_WIDTH : 0;

  // When Ticket Management deep-links "view the process in the session", we switch to
  // the session-management (archive) view and ask it to focus this Claude session id.
  const [archiveFocusSessionId, setArchiveFocusSessionId] = useState<string | null>(null);

  // The single source of truth for "which session is currently selected" across the
  // three surfaces (sidebar item, pixel character, terminal tab). Click on any of
  // them dispatches `terminal:focusTab` with a sessionId, which we capture here and
  // broadcast back down via props so all three surfaces stay in sync.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Remember the view we entered Spread from, so promoting a tile returns there.
  const prevViewRef = useRef<ViewMode>('tickets');
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    const normalizedMode = normalizeViewMode(mode);
    setViewMode((prev) => {
      if (normalizedMode === 'spread' && prev !== 'spread') prevViewRef.current = prev;
      return normalizedMode;
    });
  }, []);
  // Spread tile click → return to the prior (non-spread) view and focus that terminal.
  const handleSelectSpreadTile = useCallback((tabId: string) => {
    const back = prevViewRef.current === 'spread' ? 'animation' : prevViewRef.current;
    setViewMode(back);
    setChatOpen(true);
    window.dispatchEvent(new CustomEvent('terminal:focusTab', { detail: { tabId } }));
  }, []);

  // When a sidebar item / pixel character dispatches a focus/create event, ensure the
  // chat overlay is open AND track the selected session for cross-surface highlight.
  // For Claude sessions we key on `sessionId`; for SSH (and any tabId-only source) we
  // fall back to `tabId` so that highlight still works in the sidebar.
  useEffect(() => {
    const onFocus = (event: Event) => {
      setChatOpen(true);
      const detail = (event as CustomEvent).detail as
        | { sessionId?: string; tabId?: string }
        | undefined;
      const id = detail?.sessionId ?? detail?.tabId ?? null;
      if (id) setSelectedSessionId(id);
    };
    const onCreate = () => setChatOpen(true);
    const onResume = () => setChatOpen(true);
    // Cross-surface navigation. Legacy content modes normalize to Board while
    // preserving a target session for the later process-tab focus handoff.
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent).detail as { mode?: ViewMode; sessionId?: string } | undefined;
      if (detail?.sessionId !== undefined) setArchiveFocusSessionId(detail.sessionId);
      if (detail?.mode) handleViewModeChange(detail.mode);
    };
    window.addEventListener('terminal:focusTab', onFocus);
    window.addEventListener('terminal:createTab', onCreate);
    window.addEventListener('terminal:resumeExternal', onResume);
    window.addEventListener('claude-alive:navigate', onNavigate);
    return () => {
      window.removeEventListener('terminal:focusTab', onFocus);
      window.removeEventListener('terminal:createTab', onCreate);
      window.removeEventListener('terminal:resumeExternal', onResume);
      window.removeEventListener('claude-alive:navigate', onNavigate);
    };
  }, [handleViewModeChange]);

  // ── Shared repo/worktree/run selection (spec 2026-08-28) ──────────────────
  // Owned by the shell so every view reads one filter and one focused run.
  const [selection, dispatchSelection] = useReducer(
    selectionReducer,
    undefined,
    () => loadSelection(window.localStorage),
  );

  useEffect(() => {
    saveSelection(window.localStorage, selection);
  }, [selection]);

  const { tree: runTree } = useRunTree(true, subscribeRaw);

  const handleNewRun = useCallback((worktree: { path: string }) => {
    // Reuse the ticket composer instead of adding a second creation path; it
    // listens for this event and prefills the cwd.
    window.dispatchEvent(new CustomEvent('claude-alive:new-run', { detail: { cwd: worktree.path } }));
    handleViewModeChange('tickets');
  }, [handleViewModeChange]);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <HeaderBar
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        leftPanelOpen={leftPanelOpen}
        rightPanelOpen={rightPanelOpen}
        chatOpen={chatOpen}
        onToggleLeftPanel={() => setLeftPanelOpen(prev => !prev)}
        onToggleRightPanel={() => setRightPanelOpen(prev => !prev)}
        onToggleChat={() => setChatOpen(prev => !prev)}
        onOpenSettings={() => setSettingsOpen(true)}
        systemMetrics={systemMetrics}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ResourceAlert alert={resourceAlert} onDismiss={handleResourceAlertDismiss} />
      <BackendAlert
        alert={backendAlert}
        onDismiss={() => setBackendAlert(null)}
        onRecheck={handleBackendRecheck}
        rechecking={backendRechecking}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', marginTop: 56, position: 'relative' }}>
        {/* Sidebar + views share one row. ChatOverlay stays a sibling of this
            row so its absolute coordinates against the outer box are unchanged. */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
        <RepoSidebar
          tree={runTree}
          selection={selection}
          onAction={dispatchSelection}
          onNewRun={handleNewRun}
        />
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
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
                selectedSessionId={selectedSessionId}
                chatClaudeSessionIds={chatClaudeSessionIds}
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
                selectedSessionId={selectedSessionId}
                chatClaudeSessionIds={chatClaudeSessionIds}
                resumableSessions={resumableSessions}
              />
            </Suspense>
          </div>
          <div style={{ position: 'absolute', inset: 0, display: viewMode === 'board' ? 'block' : 'none' }}>
            <Suspense fallback={null}>
              <BoardView
                active={viewMode === 'board'}
                subscribeRaw={subscribeRaw}
                focusSessionId={archiveFocusSessionId}
              />
            </Suspense>
          </div>
          {/* Spread view body: empty-state hint, shown only when there are no open terminals.
              When tabs exist, the app-level ChatOverlay spread grid (z-index 30) covers this. */}
          <div style={{ position: 'absolute', inset: 0, display: viewMode === 'workspace' ? 'block' : 'none' }}>
            <WorkspaceTreeView active={viewMode === 'workspace'} subscribeRaw={subscribeRaw} />
          </div>
          <div style={{ position: 'absolute', inset: 0, display: viewMode === 'tickets' ? 'block' : 'none' }}>
            <Suspense fallback={null}>
              <TicketsView active={viewMode === 'tickets'} subscribeRaw={subscribeRaw} />
            </Suspense>
          </div>
          <div style={{ position: 'absolute', inset: 0, display: viewMode === 'spread' ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{i18n.t('spread.empty')}</div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>{i18n.t('spread.emptyHint')}</div>
            </div>
          </div>
        </ErrorBoundary>
        </div>
        </div>

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
          contentViewActive={viewMode === 'board'}
          listLeftInset={listLeftInset}
          onSshSessionsChange={handleSshSessionsChange}
          onChatClaudeSessionsChange={handleChatClaudeSessionsChange}
          projectNames={projectNames}
          waitingSessionIds={waitingSessionIds}
          connected={connected}
          onAttach={handleTerminalAttach}
          spreadActive={viewMode === 'spread'}
          onSelectSpreadTile={handleSelectSpreadTile}
        />
      </div>
    </div>
  );
}

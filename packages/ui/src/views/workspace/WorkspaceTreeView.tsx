/**
 * Location → Workspace → Session tree over the canonical read model (§F.2, §I.5).
 *
 * Additive by design: reads `/api/v2/workspace-tree` and does not touch the v1
 * `AgentInfo` path, so existing views keep working while the two models run side
 * by side (§F.4). Follows the app's design language — dark surfaces, rounded-2xl
 * cards, Pretendard UI / SF Mono for paths (CLAUDE.md design system).
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useWorkspaceTree, type TreeSession, type WorkspaceTree } from '../../hooks/useWorkspaceTree';
import { SessionDetail } from './SessionDetail';

/** Dot colour per canonical state, from the shared accent tokens. */
const STATE_COLOR: Record<string, string> = {
  'starting': 'var(--accent-blue)',
  'ready': 'var(--text-secondary)',
  'thinking': 'var(--accent-blue)',
  'using-tool': 'var(--accent-green)',
  'waiting-user': 'var(--accent-amber)',
  'paused': 'var(--text-secondary)',
  'completed': 'var(--accent-green)',
  'failed': 'var(--accent-red)',
  'stopped': 'var(--text-secondary)',
  'disconnected': 'var(--accent-red)',
  'unknown': 'var(--text-secondary)',
};

/** Relative "last active" label from the shared i18n unit keys. */
function relativeTime(ts: number, now: number, t: TFunction): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 45) return t('workspaceTree.lastActiveNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('workspaceTree.lastActiveMin', { count: Math.max(1, min) });
  const hour = Math.floor(min / 60);
  if (hour < 24) return t('workspaceTree.lastActiveHour', { count: hour });
  return t('workspaceTree.lastActiveDay', { count: Math.floor(hour / 24) });
}

/**
 * Control-tower ordering: sessions still awaiting a human decision float to the
 * top (that is the one thing this surface exists to make un-missable), then the
 * most recently active. Pure — returns a new array (immutability rule).
 */
function sortSessions(sessions: readonly TreeSession[]): TreeSession[] {
  return [...sessions].sort((a, b) => {
    const pending = (b.pendingApprovals > 0 ? 1 : 0) - (a.pendingApprovals > 0 ? 1 : 0);
    if (pending !== 0) return pending;
    return b.lastActiveAt - a.lastActiveAt;
  });
}

/** Total sessions awaiting approval across the whole tree. */
function countPending(tree: WorkspaceTree | null): number {
  if (!tree) return 0;
  return tree.locations.reduce(
    (n, l) =>
      n +
      l.workspaces.reduce(
        (m, w) => m + w.sessions.filter((s) => s.pendingApprovals > 0).length,
        0,
      ),
    0,
  );
}

function Centered({ title, hint, tone }: { title: string; hint?: string; tone?: 'error' }): React.ReactElement {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1.5 px-8 text-center">
      <p className="text-sm" style={{ color: tone === 'error' ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
        {title}
      </p>
      {hint ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SessionRow({
  session,
  selected,
  now,
  onSelect,
}: {
  session: TreeSession;
  selected: boolean;
  now: number;
  onSelect: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li
      role="button"
      tabIndex={0}
      aria-current={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className="flex items-center gap-2.5 rounded-xl px-3 py-2 cursor-pointer transition-all duration-200"
      style={{ background: selected ? 'var(--bg-card)' : 'transparent' }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = 'var(--bg-secondary)';
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span
        aria-hidden
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: STATE_COLOR[session.state] ?? STATE_COLOR.unknown }}
      />
      <span
        className="truncate text-sm font-medium flex-1 min-w-0"
        style={{ color: 'var(--text-primary)' }}
        title={session.firstPromptPreview ?? session.title}
      >
        {session.title}
      </span>
      {session.currentTool ? (
        <span
          className="text-xs px-2 py-0.5 rounded-full shrink-0 font-medium"
          style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
        >
          {session.currentTool}
        </span>
      ) : null}
      {session.pendingApprovals > 0 ? (
        <span
          className="text-xs px-2 py-0.5 rounded-full shrink-0 font-semibold"
          style={{ background: 'var(--accent-amber)', color: 'var(--bg-primary)' }}
        >
          {t('workspaceTree.pendingApprovals', { count: session.pendingApprovals })}
        </span>
      ) : (
        <span
          className="text-xs shrink-0 tabular-nums"
          style={{ color: 'var(--text-secondary)', opacity: 0.7, fontFamily: 'var(--font-mono)' }}
          title={t('workspaceTree.lastActiveTitle')}
        >
          {relativeTime(session.lastActiveAt, now, t)}
        </span>
      )}
      {session.stateConfidence === 'heuristic' ? (
        <span
          className="text-xs shrink-0"
          style={{ color: 'var(--text-secondary)', opacity: 0.6 }}
          title={t('workspaceTree.heuristicHint')}
        >
          {t('workspaceTree.heuristic')}
        </span>
      ) : null}
    </li>
  );
}

/**
 * Left-pane header that gives the view its "control tower" identity: it leads
 * with how many sessions await a human decision (the cross-repo question no
 * other surface answers) and lets you narrow to just those.
 */
function ControlTowerHeader({
  pendingTotal,
  onlyPending,
  onToggle,
}: {
  pendingTotal: number;
  onlyPending: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const hasPending = pendingTotal > 0;
  return (
    <div className="shrink-0 px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
      <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {t('workspaceTree.headerTitle')}
      </h1>
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)', opacity: 0.8 }}>
        {t('workspaceTree.headerSubtitle')}
      </p>
      <div className="flex items-center gap-2 mt-2.5">
        <span
          className="text-xs px-2 py-1 rounded-lg font-semibold"
          style={{
            background: hasPending ? 'var(--accent-amber)' : 'var(--bg-card)',
            color: hasPending ? 'var(--bg-primary)' : 'var(--text-secondary)',
          }}
        >
          {hasPending ? t('workspaceTree.pendingTotal', { count: pendingTotal }) : t('workspaceTree.pendingNone')}
        </span>
        {hasPending || onlyPending ? (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={onlyPending}
            className="text-xs px-2 py-1 rounded-lg font-medium transition-all duration-200"
            style={{
              background: onlyPending ? 'var(--bg-card)' : 'transparent',
              color: onlyPending ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            {onlyPending ? t('workspaceTree.showAll') : t('workspaceTree.showPendingOnly')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function WorkspaceTreeView({
  active,
  subscribeRaw,
}: {
  active: boolean;
  subscribeRaw?: (handler: (msg: unknown) => void) => () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { tree, loading, unavailable, error } = useWorkspaceTree({ active, subscribeRaw });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);

  const now = Date.now();
  const locations = tree?.locations ?? [];
  const total = locations.reduce((n, l) => n + l.workspaces.reduce((m, w) => m + w.sessions.length, 0), 0);
  const pendingTotal = useMemo(() => countPending(tree), [tree]);

  // Filter (when the pending-only lens is on) then sort so awaiting-approval
  // sessions surface first. Empty workspaces/locations are dropped from view.
  const visibleLocations = useMemo(
    () =>
      locations
        .map((loc) => ({
          ...loc,
          workspaces: loc.workspaces
            .map((w) => ({
              ...w,
              sessions: sortSessions(
                onlyPending ? w.sessions.filter((s) => s.pendingApprovals > 0) : w.sessions,
              ),
            }))
            .filter((w) => w.sessions.length > 0),
        }))
        .filter((loc) => loc.workspaces.length > 0),
    [locations, onlyPending],
  );

  let listBody: React.ReactElement;
  if (loading) listBody = <Centered title={t('workspaceTree.loading')} />;
  else if (unavailable) listBody = <Centered title={t('workspaceTree.unavailable')} hint={t('workspaceTree.unavailableHint')} />;
  else if (error) listBody = <Centered title={t('workspaceTree.error')} hint={error} tone="error" />;
  else if (total === 0) listBody = <Centered title={t('workspaceTree.empty')} />;
  else if (visibleLocations.length === 0) listBody = <Centered title={t('workspaceTree.allClear')} hint={t('workspaceTree.allClearHint')} />;
  else {
    listBody = (
      <div className="h-full overflow-y-auto px-3 py-4">
        {visibleLocations.map(({ location, workspaces }) => (
          <section key={location.locationId} className="mb-6">
            <div className="flex items-center gap-2 px-2 mb-2.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: location.status === 'online' ? 'var(--accent-green)' : 'var(--text-secondary)' }}
              />
              <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                {location.displayName}
              </h2>
            </div>
            {workspaces.map(({ workspace, sessions }) => (
              <div
                key={workspace.workspaceId}
                className="mb-2 rounded-2xl overflow-hidden"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
              >
                <div className="flex items-baseline gap-2 px-4 pt-3 pb-1">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {workspace.displayName}
                  </span>
                  <span className="text-xs truncate" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {workspace.kind === 'git' ? (workspace.repo?.owner ?? t('workspaceTree.gitRepo')) : t('workspaceTree.folder')}
                  </span>
                  <span
                    className="text-xs ml-auto px-2 py-0.5 rounded-full font-medium"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
                  >
                    {t('workspaceTree.sessionCount', { count: sessions.length })}
                  </span>
                </div>
                <ul className="px-2 pb-2">
                  {sessions.map((session) => (
                    <SessionRow
                      key={session.sessionId}
                      session={session}
                      selected={session.sessionId === selectedSessionId}
                      now={now}
                      onSelect={() => setSelectedSessionId(session.sessionId)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    );
  }

  const showHeader = !loading && !unavailable && !error && total > 0;
  const leftPane = (
    <div className="h-full flex flex-col">
      {showHeader ? (
        <ControlTowerHeader
          pendingTotal={pendingTotal}
          onlyPending={onlyPending}
          onToggle={() => setOnlyPending((v) => !v)}
        />
      ) : null}
      <div className="flex-1 min-h-0">{listBody}</div>
    </div>
  );

  return (
    <div className="h-full flex" style={{ background: 'var(--bg-primary)', fontFamily: 'var(--font-ui)' }}>
      <div className="w-[360px] shrink-0 h-full overflow-hidden" style={{ borderRight: '1px solid var(--border-color)' }}>
        {leftPane}
      </div>
      <div className="flex-1 min-w-0 h-full">
        <SessionDetail sessionId={selectedSessionId} />
      </div>
    </div>
  );
}

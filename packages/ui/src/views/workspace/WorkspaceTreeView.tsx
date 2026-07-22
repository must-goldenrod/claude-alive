/**
 * Location → Workspace → Session tree over the canonical read model (§F.2, §I.5).
 *
 * Additive by design: reads `/api/v2/workspace-tree` and does not touch the v1
 * `AgentInfo` path, so existing views keep working while the two models run side
 * by side (§F.4). Follows the app's design language — dark surfaces, rounded-2xl
 * cards, Pretendard UI / SF Mono for paths (CLAUDE.md design system).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceTree, type TreeSession } from '../../hooks/useWorkspaceTree';
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
  onSelect,
}: {
  session: TreeSession;
  selected: boolean;
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
        <span className="text-xs shrink-0 font-semibold" style={{ color: 'var(--accent-amber)' }}>
          {t('workspaceTree.pendingApprovals', { count: session.pendingApprovals })}
        </span>
      ) : null}
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

  const locations = tree?.locations ?? [];
  const total = locations.reduce((n, l) => n + l.workspaces.reduce((m, w) => m + w.sessions.length, 0), 0);

  let leftPane: React.ReactElement;
  if (loading) leftPane = <Centered title={t('workspaceTree.loading')} />;
  else if (unavailable) leftPane = <Centered title={t('workspaceTree.unavailable')} hint={t('workspaceTree.unavailableHint')} />;
  else if (error) leftPane = <Centered title={t('workspaceTree.error')} hint={error} tone="error" />;
  else if (total === 0) leftPane = <Centered title={t('workspaceTree.empty')} />;
  else {
    leftPane = (
      <div className="h-full overflow-y-auto px-3 py-4">
        {locations.map(({ location, workspaces }) => (
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

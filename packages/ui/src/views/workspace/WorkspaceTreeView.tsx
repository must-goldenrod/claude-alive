/**
 * Location → Workspace → Session tree over the canonical read model (§F.2, §I.5).
 *
 * Additive by design: this reads `/api/v2/workspace-tree` and does not touch the
 * v1 `AgentInfo` path, so the existing views keep working unchanged while the two
 * models run side by side (§F.4 "1차: 기존 탭 유지").
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceTree, type TreeSession } from '../../hooks/useWorkspaceTree';
import { ConversationPanel } from './ConversationPanel';

/** Dot colour per canonical state; unknown states fall back to neutral. */
const STATE_COLOR: Record<string, string> = {
  'starting': 'var(--accent-blue)',
  'ready': 'var(--text-tertiary)',
  'thinking': 'var(--accent-blue)',
  'using-tool': 'var(--accent-green)',
  'waiting-user': 'var(--accent-amber)',
  'paused': 'var(--text-tertiary)',
  'completed': 'var(--accent-green)',
  'failed': 'var(--accent-red)',
  'stopped': 'var(--text-tertiary)',
  'disconnected': 'var(--accent-red)',
  'unknown': 'var(--text-tertiary)',
};

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
      className={`flex items-center gap-2 py-1.5 pl-6 pr-3 rounded-lg cursor-pointer transition-colors ${
        selected ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-hover)]'
      }`}
    >
      <span
        aria-hidden
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: STATE_COLOR[session.state] ?? STATE_COLOR.unknown }}
      />
      <span className="truncate text-sm" title={session.firstPromptPreview ?? session.title}>
        {session.title}
      </span>
      {session.currentTool ? (
        <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] shrink-0">
          {session.currentTool}
        </span>
      ) : null}
      {session.pendingApprovals > 0 ? (
        <span className="text-xs text-[var(--accent-amber)] shrink-0">
          {t('workspaceTree.pendingApprovals', { count: session.pendingApprovals })}
        </span>
      ) : null}
      {/* State confidence is surfaced, never hidden: a heuristic state must not
          read as fact (§C.8). */}
      {session.stateConfidence === 'heuristic' ? (
        <span className="text-xs text-[var(--text-tertiary)] shrink-0" title={t('workspaceTree.heuristicHint')}>
          {t('workspaceTree.heuristic')}
        </span>
      ) : null}
    </li>
  );
}

export function WorkspaceTreeView({ active }: { active: boolean }): React.ReactElement {
  const { t } = useTranslation();
  const { tree, loading, unavailable, error } = useWorkspaceTree({ active });
  // Selecting a session opens its conversation; it never resumes it (§F.7).
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  if (loading) {
    return <p className="p-6 text-sm text-[var(--text-tertiary)]">{t('workspaceTree.loading')}</p>;
  }

  // "Cannot read" and "nothing to show" are different facts and get different copy.
  if (unavailable) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--text-secondary)]">{t('workspaceTree.unavailable')}</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">{t('workspaceTree.unavailableHint')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--accent-red)]">{t('workspaceTree.error')}</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">{error}</p>
      </div>
    );
  }

  const locations = tree?.locations ?? [];
  const total = locations.reduce((n, l) => n + l.workspaces.reduce((m, w) => m + w.sessions.length, 0), 0);

  if (total === 0) {
    return <p className="p-6 text-sm text-[var(--text-tertiary)]">{t('workspaceTree.empty')}</p>;
  }

  return (
    <div className="h-full flex">
      <div className="w-[340px] shrink-0 h-full overflow-y-auto p-4 border-r border-[var(--border-primary)]">
      {locations.map(({ location, workspaces }) => (
        <section key={location.locationId} className="mb-5">
          <h2 className="px-2 mb-2 text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
            {location.displayName}
          </h2>
          {workspaces.map(({ workspace, sessions }) => (
            <div key={workspace.workspaceId} className="mb-3">
              <div className="flex items-baseline gap-2 px-2 py-1">
                <span className="text-sm font-medium">{workspace.displayName}</span>
                <span className="text-xs text-[var(--text-tertiary)]">
                  {workspace.kind === 'git'
                    ? (workspace.repo?.owner ?? t('workspaceTree.gitRepo'))
                    : t('workspaceTree.folder')}
                </span>
                <span className="text-xs text-[var(--text-tertiary)] ml-auto">
                  {t('workspaceTree.sessionCount', { count: sessions.length })}
                </span>
              </div>
              <ul>
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
      <div className="flex-1 min-w-0 h-full">
        <ConversationPanel sessionId={selectedSessionId} />
      </div>
    </div>
  );
}

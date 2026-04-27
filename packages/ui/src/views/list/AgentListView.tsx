import type { AgentInfo } from '@claude-alive/core';
import type { SshSessionInfo } from '../chat/ChatOverlay.tsx';
import { ProjectSidebar } from '../unified/ProjectSidebar.tsx';

interface AgentListViewProps {
  agents: AgentInfo[];
  leftPanelOpen?: boolean;
  sshSessions?: SshSessionInfo[];
  projectNames?: Record<string, string>;
  onProjectNameChange?: (cwd: string, name: string | null) => void;
  selectedSessionId?: string | null;
  chatClaudeSessionIds?: Set<string>;
}

/**
 * List view: just the ProjectSidebar on the left and an empty body.
 * The terminal is rendered by the App-level ChatOverlay as a fixed-position overlay that
 * covers the body area (using listLeftInset to avoid the sidebar). This avoids moving xterm
 * DOM between locations — the overlay simply animates its coordinates when the view changes.
 */
export function AgentListView({
  agents,
  leftPanelOpen = true,
  sshSessions,
  projectNames,
  onProjectNameChange,
  selectedSessionId,
  chatClaudeSessionIds,
}: AgentListViewProps) {
  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      <ProjectSidebar
        agents={agents}
        collapsed={!leftPanelOpen}
        sshSessions={sshSessions}
        projectNames={projectNames}
        onProjectNameChange={onProjectNameChange}
        selectedSessionId={selectedSessionId}
        chatClaudeSessionIds={chatClaudeSessionIds}
        onAgentClick={(sessionId) =>
          window.dispatchEvent(
            new CustomEvent('terminal:focusTab', { detail: { sessionId } }),
          )
        }
      />
      {/* Intentionally empty — the fixed-position ChatOverlay covers this region when
          viewMode === 'list'. The empty div preserves flex layout symmetry. */}
      <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-primary)' }} />
    </div>
  );
}

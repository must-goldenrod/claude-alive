import type { AgentInfo, ResumableSession } from '@claude-alive/core';
import type { SshSessionInfo } from '../chat/ChatOverlay.tsx';
import { ProjectSidebar } from '../unified/ProjectSidebar.tsx';
import { SessionDashboardView } from './SessionDashboardView.tsx';

interface AgentListViewProps {
  agents: AgentInfo[];
  leftPanelOpen?: boolean;
  sshSessions?: SshSessionInfo[];
  projectNames?: Record<string, string>;
  onProjectNameChange?: (cwd: string, name: string | null) => void;
  selectedSessionId?: string | null;
  chatClaudeSessionIds?: Set<string>;
  resumableSessions?: ResumableSession[];
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
  resumableSessions = [],
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
      {/* Session dashboard. The fixed-position ChatOverlay covers this region while a
          terminal tab is open; when no tab is open the overlay hides itself (opacity 0)
          and this dashboard shows through, listing live and resumable sessions. */}
      <SessionDashboardView
        agents={agents}
        resumableSessions={resumableSessions}
        openSessionIds={chatClaudeSessionIds ?? new Set()}
        projectNames={projectNames}
      />
    </div>
  );
}

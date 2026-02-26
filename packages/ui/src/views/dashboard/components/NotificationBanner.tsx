import { useTranslation } from 'react-i18next';
import type { AgentInfo } from '@claude-alive/core';

const ATTENTION_STATES: Record<string, { color: string; icon: string; messageKey: string }> = {
  waiting: { color: 'var(--accent-amber)', icon: '\u26A0\uFE0F', messageKey: 'notifications.needsPermission' },
  error: { color: 'var(--accent-red)', icon: '\u274C', messageKey: 'notifications.errorOccurred' },
  done: { color: 'var(--accent-green)', icon: '\u2705', messageKey: 'notifications.taskCompleted' },
};

interface NotificationBannerProps {
  agents: AgentInfo[];
}

export function NotificationBanner({ agents }: NotificationBannerProps) {
  const { t } = useTranslation();
  const attentionAgents = agents.filter((a) => a.state in ATTENTION_STATES);

  if (attentionAgents.length === 0) return null;

  return (
    <div className="space-y-3">
      {attentionAgents.map((agent) => {
        const config = ATTENTION_STATES[agent.state]!;
        const label = agent.displayName || agent.projectName || agent.sessionId.slice(0, 8);
        return (
          <div
            key={agent.sessionId}
            className="flex items-center gap-4 px-5 py-4 rounded-lg border"
            style={{
              borderColor: config.color,
              background: `${config.color}10`,
            }}
          >
            <span className="text-lg shrink-0">{config.icon}</span>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {label}
              </span>
              <span className="text-sm mx-2" style={{ color: 'var(--text-secondary)' }}>—</span>
              <span className="text-sm" style={{ color: config.color }}>
                {t(config.messageKey)}
              </span>
            </div>
            <span className="text-xs font-mono shrink-0" style={{ color: 'var(--text-secondary)' }}>
              {agent.sessionId.slice(0, 8)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

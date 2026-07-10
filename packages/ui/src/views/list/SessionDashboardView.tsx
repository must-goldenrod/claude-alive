import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentInfo, ResumableSession } from '@claude-alive/core';
import { useNow } from '../dashboard/hooks/useNow.ts';

/** Cross-platform basename — mirror of the server helper. */
function basename(p: string | undefined): string {
  if (!p) return '';
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
}

function relativeTime(from: number, now: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const secs = Math.max(0, Math.round((now - from) / 1000));
  if (secs < 60) return t('dashboard.time.now');
  const mins = Math.round(secs / 60);
  if (mins < 60) return t('dashboard.time.minutesAgo', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('dashboard.time.hoursAgo', { n: hours });
  const days = Math.round(hours / 24);
  return t('dashboard.time.daysAgo', { n: days });
}

interface CardEntry {
  key: string;
  title: string;
  subtitle: string;
  lastPrompt: string | null;
  timeLabel: string;
  status: 'live' | 'external' | 'dormant';
  action: () => void;
}

interface SessionDashboardViewProps {
  agents: AgentInfo[];
  resumableSessions: ResumableSession[];
  /** Claude session ids currently open as terminal tabs (live/attached). */
  openSessionIds: Set<string>;
  projectNames?: Record<string, string>;
}

const STATUS_COLOR: Record<CardEntry['status'], string> = {
  live: 'var(--accent-green, #3fb950)',
  external: 'var(--accent-blue, #58a6ff)',
  dormant: 'var(--text-secondary)',
};

/**
 * Agent-style dashboard shown in the list view when no terminal tab is open.
 * Surfaces two groups of sessions and lets the user jump into any of them:
 *   - Live agents currently tracked over WebSocket (focus or resume in place).
 *   - Dormant sessions persisted across a server restart (resume via `claude --resume`).
 */
export function SessionDashboardView({
  agents,
  resumableSessions,
  openSessionIds,
  projectNames,
}: SessionDashboardViewProps) {
  const { t } = useTranslation();
  const now = useNow();

  const { liveCards, dormantCards } = useMemo(() => {
    const projectLabel = (cwd: string | undefined, fallback: string): string => {
      if (cwd && projectNames?.[cwd]) return projectNames[cwd]!;
      return basename(cwd) || fallback;
    };

    // Root agents only (subagents are shown nested in the sidebar, not here),
    // excluding those already torn down.
    const live: CardEntry[] = agents
      .filter((a) => !a.parentId && a.state !== 'despawning' && a.state !== 'removed')
      .map((a) => {
        const isOpen = openSessionIds.has(a.sessionId);
        return {
          key: a.sessionId,
          title: a.displayName || projectLabel(a.cwd, a.projectName),
          subtitle: a.cwd || '',
          lastPrompt: a.lastPrompt,
          timeLabel: relativeTime(a.lastEventTime, now, t),
          status: a.source === 'external' ? 'external' : 'live',
          action: () => {
            if (isOpen) {
              window.dispatchEvent(new CustomEvent('terminal:focusTab', { detail: { sessionId: a.sessionId } }));
            } else {
              window.dispatchEvent(
                new CustomEvent('terminal:resumeExternal', { detail: { sessionId: a.sessionId, cwd: a.cwd } }),
              );
            }
          },
        };
      });

    // Dormant: persisted sessions with no live agent and not currently open.
    const liveIds = new Set(agents.map((a) => a.sessionId));
    const dormant: CardEntry[] = resumableSessions
      .filter((s) => !liveIds.has(s.claudeSessionId) && !openSessionIds.has(s.claudeSessionId))
      .map((s) => ({
        key: s.tabId,
        title: s.displayName || projectLabel(s.cwd, s.claudeSessionId.slice(0, 8)),
        subtitle: s.cwd || '',
        lastPrompt: null,
        timeLabel: relativeTime(s.lastActive, now, t),
        status: 'dormant' as const,
        action: () => {
          window.dispatchEvent(
            new CustomEvent('terminal:resumeExternal', { detail: { sessionId: s.claudeSessionId, cwd: s.cwd } }),
          );
        },
      }));

    return { liveCards: live, dormantCards: dormant };
  }, [agents, resumableSessions, openSessionIds, projectNames, now, t]);

  const isEmpty = liveCards.length === 0 && dormantCards.length === 0;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        overflowY: 'auto',
        background: 'var(--bg-primary)',
        padding: 24,
      }}
    >
      <h1 style={{ font: '600 18px/1.2 var(--font-ui)', color: 'var(--text-primary)', margin: '0 0 4px' }}>
        {t('dashboard.title')}
      </h1>
      <p style={{ font: '400 13px/1.4 var(--font-ui)', color: 'var(--text-secondary)', margin: '0 0 20px' }}>
        {t('dashboard.subtitle')}
      </p>

      {isEmpty && (
        <div
          style={{
            border: '1px dashed var(--border-color)',
            borderRadius: 12,
            padding: '40px 24px',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            font: '400 13px/1.5 var(--font-ui)',
          }}
        >
          {t('dashboard.empty')}
        </div>
      )}

      {liveCards.length > 0 && (
        <Section title={t('dashboard.section.live', { n: liveCards.length })} cards={liveCards} t={t} />
      )}
      {dormantCards.length > 0 && (
        <Section title={t('dashboard.section.dormant', { n: dormantCards.length })} cards={dormantCards} t={t} />
      )}
    </div>
  );
}

function Section({
  title,
  cards,
  t,
}: {
  title: string;
  cards: CardEntry[];
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          font: '600 12px/1 var(--font-ui)',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--text-secondary)',
          margin: '0 0 12px',
        }}
      >
        {title}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {cards.map((card) => (
          <Card key={card.key} card={card} t={t} />
        ))}
      </div>
    </section>
  );
}

function Card({ card, t }: { card: CardEntry; t: (k: string, o?: Record<string, unknown>) => string }) {
  const actionLabel =
    card.status === 'dormant'
      ? t('dashboard.action.resume')
      : card.status === 'external'
        ? t('dashboard.action.resume')
        : t('dashboard.action.focus');

  return (
    <button
      onClick={card.action}
      style={{
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 16,
        borderRadius: 16,
        border: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        cursor: 'pointer',
        transition: 'transform 0.12s ease, background-color 0.12s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.background = 'var(--bg-tertiary, #161b22)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.background = 'var(--bg-secondary)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: STATUS_COLOR[card.status],
            flexShrink: 0,
          }}
        />
        <span
          style={{
            font: '600 14px/1.2 var(--font-ui)',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {card.title}
        </span>
        <span style={{ marginLeft: 'auto', font: '400 11px/1 var(--font-mono)', color: 'var(--text-secondary)' }}>
          {card.timeLabel}
        </span>
      </div>

      {card.subtitle && (
        <div
          style={{
            font: '400 11px/1.3 var(--font-mono)',
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {card.subtitle}
        </div>
      )}

      {card.lastPrompt && (
        <div
          style={{
            font: '400 12px/1.4 var(--font-ui)',
            color: 'var(--text-primary)',
            opacity: 0.8,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {card.lastPrompt}
        </div>
      )}

      <span
        style={{
          marginTop: 4,
          alignSelf: 'flex-start',
          font: '500 11px/1 var(--font-ui)',
          color: STATUS_COLOR[card.status],
        }}
      >
        {actionLabel} →
      </span>
    </button>
  );
}

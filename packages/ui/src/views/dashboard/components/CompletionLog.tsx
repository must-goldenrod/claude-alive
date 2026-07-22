import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompletedSession } from '@claude-alive/core';
import { useNow } from '../hooks/useNow.ts';
import type { TFunction } from 'i18next';

function formatTimeSince(now: number, timestamp: number, t: TFunction): string {
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 1) return t('time.justNow');
  if (seconds < 60) return t('time.secondsAgo', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  return t('time.hoursAgo', { count: Math.floor(minutes / 60) });
}

interface CompletionLogProps {
  completedSessions: CompletedSession[];
}

export function CompletionLog({ completedSessions }: CompletionLogProps) {
  const { t } = useTranslation();
  const now = useNow();
  const listRef = useRef<HTMLDivElement>(null);

  // New completions are prepended (most-recent-first), so keep the scroll pinned
  // to the TOP when one arrives — the previous code scrolled to the bottom, i.e.
  // away from where the new item actually appeared.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [completedSessions.length]);

  // Show most recent first
  const sorted = [...completedSessions].reverse();

  return (
    <div
      className="flex flex-col border rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', maxHeight: 220 }}
    >
      <div
        className="px-5 py-4 text-[13px] font-semibold border-b shrink-0 flex items-center justify-between"
        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}
      >
        <span>{t('completionLog.title')}</span>
        <span className="flex items-center gap-2">
          {completedSessions.length > 0 && (
            <span
              className="px-2.5 py-0.5 rounded-md text-[11px] font-medium"
              style={{ background: 'var(--accent-green)20', color: 'var(--accent-green)' }}
            >
              {completedSessions.length}
            </span>
          )}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('claude-alive:navigate', { detail: { mode: 'archive' } }))}
            className="text-[11px] font-medium"
            style={{ color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {t('completionLog.viewAll')}
          </button>
        </span>
      </div>
      <div ref={listRef} className="overflow-y-auto p-3 space-y-0.5">
        {sorted.length === 0 ? (
          <div className="text-center py-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('completionLog.empty')}
          </div>
        ) : (
          sorted.map((session, i) => (
            <div
              key={`${session.sessionId}-${i}`}
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs hover:bg-white/5 transition-colors"
            >
              <span className="shrink-0" style={{ color: 'var(--accent-green)' }}>●</span>
              <span
                className="font-medium truncate"
                style={{ color: 'var(--text-primary)', maxWidth: 110 }}
                title={session.cwd}
              >
                {session.projectName}
              </span>
              <span className="truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
                {session.displayName || t('agents.generalAgent')}
              </span>
              <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                {formatTimeSince(now, session.completedAt, t)}
              </span>
              {session.tokenUsage && (
                <span
                  className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-medium"
                  style={{ background: 'var(--accent-blue)15', color: 'var(--accent-blue)' }}
                >
                  {session.tokenUsage.totalTokens.toLocaleString()} {t('completionLog.tokensShort')}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

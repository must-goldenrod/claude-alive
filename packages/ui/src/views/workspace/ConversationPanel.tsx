/**
 * Read-only conversation for the selected session (§F.7).
 *
 * Opening a session shows its dialogue; it never resumes or attaches. When a full
 * transcript exists it is shown whole (`completeness: 'transcript'`); a
 * hook-derived view is partial and says so. Terminal escape sequences are never
 * rendered here — raw output belongs to the Terminal tab.
 *
 * Styled to the app's chat language: user text right-aligned in a card, assistant
 * text left, tool calls as compact mono chips (CLAUDE.md design system).
 */

import { useTranslation } from 'react-i18next';
import { useConversation, type ConversationItem } from '../../hooks/useConversation';

function Bubble({ item }: { item: ConversationItem }): React.ReactElement {
  const { t } = useTranslation();
  const isUser = item.kind === 'user';

  if (item.kind === 'user' || item.kind === 'assistant' || item.kind === 'reasoning') {
    const muted = item.kind === 'reasoning';
    return (
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div className="max-w-[80%]">
          <div
            className="text-xs mb-1 px-1"
            style={{ color: 'var(--text-secondary)', textAlign: isUser ? 'right' : 'left', opacity: muted ? 0.6 : 1 }}
          >
            {t(`conversation.role.${item.kind}`)}
          </div>
          <div
            className="text-sm rounded-2xl px-4 py-2.5 whitespace-pre-wrap break-words"
            style={{
              background: isUser ? 'var(--accent-blue)' : 'var(--bg-card)',
              color: isUser ? '#fff' : 'var(--text-primary)',
              border: isUser ? 'none' : '1px solid var(--border-color)',
              opacity: muted ? 0.75 : 1,
            }}
          >
            {item.text}
          </div>
        </div>
      </div>
    );
  }

  if (item.kind === 'tool-call') {
    const dot =
      item.status === 'failed' ? 'var(--accent-red)' : item.status === 'completed' ? 'var(--accent-green)' : 'var(--accent-blue)';
    return (
      <div className="flex justify-start">
        <div
          className="flex items-center gap-2 text-xs rounded-full px-3 py-1"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
          <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{item.toolName ?? t('conversation.tool')}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{t(`conversation.status.${item.status ?? 'running'}`)}</span>
        </div>
      </div>
    );
  }

  if (item.kind === 'approval') {
    return (
      <div className="flex justify-start">
        <div
          className="flex items-center gap-2 text-xs rounded-full px-3 py-1 font-medium"
          style={{ background: 'var(--bg-card)', color: 'var(--accent-amber)', border: '1px solid var(--accent-amber)' }}
        >
          <span>{t('conversation.approval')}</span>
          {item.toolName ? <span style={{ fontFamily: 'var(--font-mono)' }}>{item.toolName}</span> : null}
          {item.decision ? <span style={{ color: 'var(--text-secondary)' }}>{t(`conversation.decision.${item.decision}`)}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="text-xs text-center" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
      {t('conversation.systemEvent')}
    </div>
  );
}

export function ConversationPanel({ sessionId }: { sessionId: string | null }): React.ReactElement {
  const { t } = useTranslation();
  const { items, loading, notFound, unavailable, error, completeness } = useConversation(sessionId);

  const centered = (text: string, tone?: 'error') => (
    <p className="h-full flex items-center justify-center px-8 text-center text-sm" style={{ color: tone === 'error' ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
      {text}
    </p>
  );

  if (!sessionId) return centered(t('conversation.selectPrompt'));
  if (loading) return centered(t('conversation.loading'));
  if (notFound) return centered(t('conversation.notFound'));
  if (unavailable) return centered(t('conversation.unavailable'));
  if (error) return centered(error, 'error');

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      {/* Partial only when hook-derived; a full transcript needs no caveat. */}
      {completeness === 'hook-derived' ? (
        <div
          className="mb-4 text-xs rounded-xl px-3 py-2"
          style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
        >
          {t('conversation.partialNotice')}
        </div>
      ) : null}
      {items.length === 0 ? (
        centered(t('conversation.empty'))
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <Bubble key={item.itemId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Read-only conversation for the selected session (§F.7).
 *
 * Opening a session shows its dialogue; it never resumes or attaches. Tool output
 * and terminal escape sequences are deliberately not rendered here — raw output
 * belongs to the Terminal surface, and rendering escapes as HTML is forbidden.
 */

import { useTranslation } from 'react-i18next';
import { useConversation, type ConversationItem } from '../../hooks/useConversation';

function ItemRow({ item }: { item: ConversationItem }): React.ReactElement {
  const { t } = useTranslation();

  if (item.kind === 'user' || item.kind === 'assistant' || item.kind === 'reasoning') {
    const isUser = item.kind === 'user';
    return (
      <div className={`mb-3 ${isUser ? 'pl-0' : 'pl-4'}`}>
        <div className="text-xs mb-1 text-[var(--text-tertiary)]">
          {t(`conversation.role.${item.kind}`)}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words text-[var(--text-primary)]">{item.text}</div>
      </div>
    );
  }

  if (item.kind === 'tool-call') {
    return (
      <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <span className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)]">{item.toolName ?? t('conversation.tool')}</span>
        <span>{t(`conversation.status.${item.status ?? 'running'}`)}</span>
        {item.detail ? <span className="text-[var(--accent-red)] truncate">{item.detail}</span> : null}
      </div>
    );
  }

  if (item.kind === 'approval') {
    return (
      <div className="mb-2 flex items-center gap-2 text-xs text-[var(--accent-amber)]">
        <span>{t('conversation.approval')}</span>
        {item.toolName ? <span>{item.toolName}</span> : null}
        {item.decision ? <span>{t(`conversation.decision.${item.decision}`)}</span> : null}
      </div>
    );
  }

  return (
    <div className="mb-2 text-xs text-[var(--text-tertiary)]">
      {t('conversation.systemEvent')} · {item.detail}
    </div>
  );
}

export function ConversationPanel({ sessionId }: { sessionId: string | null }): React.ReactElement {
  const { t } = useTranslation();
  const { items, loading, notFound, unavailable, error, completeness } = useConversation(sessionId);

  if (!sessionId) {
    return <p className="p-6 text-sm text-[var(--text-tertiary)]">{t('conversation.selectPrompt')}</p>;
  }
  if (loading) {
    return <p className="p-6 text-sm text-[var(--text-tertiary)]">{t('conversation.loading')}</p>;
  }
  if (notFound) {
    return <p className="p-6 text-sm text-[var(--text-secondary)]">{t('conversation.notFound')}</p>;
  }
  if (unavailable) {
    return <p className="p-6 text-sm text-[var(--text-secondary)]">{t('conversation.unavailable')}</p>;
  }
  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--accent-red)]">{t('conversation.error')}</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Never imply this is the whole transcript when the source is partial. */}
      {completeness === 'hook-derived' ? (
        <p className="mb-3 text-xs text-[var(--text-tertiary)]">{t('conversation.partialNotice')}</p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">{t('conversation.empty')}</p>
      ) : (
        items.map((item) => <ItemRow key={item.itemId} item={item} />)
      )}
    </div>
  );
}

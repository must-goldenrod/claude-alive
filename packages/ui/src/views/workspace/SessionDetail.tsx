/**
 * Session detail surface: Conversation ↔ Terminal (§F.7).
 *
 * Conversation is the default — opening a session reads it, never resumes it.
 * The Terminal tab reports whether Alive owns a pty for this session and, when it
 * does not, says why: an externally-started session is readable from hooks but
 * has no process of ours to attach to. A blank pane would leave "no output yet"
 * and "we never owned this process" indistinguishable.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConversationPanel } from './ConversationPanel';

type Tab = 'conversation' | 'terminal';

interface TerminalLink {
  available: boolean;
  live: boolean;
  tabId?: string;
  reason?: string;
}

function TerminalTab({ sessionId }: { sessionId: string }): React.ReactElement {
  const { t } = useTranslation();
  const [link, setLink] = useState<TerminalLink | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLink(null);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(`/api/v2/sessions/${encodeURIComponent(sessionId)}/terminal`);
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        setLink((await res.json()) as TerminalLink);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (failed) return <p className="p-6 text-sm text-[var(--accent-red)]">{t('sessionDetail.terminalError')}</p>;
  if (!link) return <p className="p-6 text-sm text-[var(--text-tertiary)]">{t('sessionDetail.terminalLoading')}</p>;

  if (!link.available) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--text-secondary)]">{t('sessionDetail.noTerminal')}</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          {t(`sessionDetail.reason.${link.reason ?? 'unknown-session'}`)}
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <p className="text-sm text-[var(--text-primary)]">
        {link.live ? t('sessionDetail.terminalLive') : t('sessionDetail.terminalExited')}
      </p>
      <p className="mt-1 text-xs text-[var(--text-tertiary)]">
        {t('sessionDetail.terminalTab', { tabId: link.tabId })}
      </p>
      <p className="mt-3 text-xs text-[var(--text-tertiary)]">{t('sessionDetail.terminalHint')}</p>
    </div>
  );
}

export function SessionDetail({ sessionId }: { sessionId: string | null }): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('conversation');

  // A new selection always lands on the conversation, per §F.7.
  useEffect(() => {
    setTab('conversation');
  }, [sessionId]);

  if (!sessionId) {
    return <p className="p-6 text-sm text-[var(--text-tertiary)]">{t('conversation.selectPrompt')}</p>;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex gap-1 px-3 pt-3 border-b border-[var(--border-primary)]" role="tablist">
        {(['conversation', 'terminal'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-sm rounded-t-lg transition-colors ${
              tab === id
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {t(`sessionDetail.tab.${id}`)}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'conversation' ? <ConversationPanel sessionId={sessionId} /> : <TerminalTab sessionId={sessionId} />}
      </div>
    </div>
  );
}

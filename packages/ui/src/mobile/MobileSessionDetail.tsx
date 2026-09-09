import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { COLORS, screen, topBar, body, secondaryButton, actionBar, primaryButton } from './styles.ts';

export interface ConversationEntry {
  itemId: string;
  kind: 'user' | 'assistant' | 'reasoning' | 'tool-call' | 'approval' | 'artifact' | 'system-event';
  occurredAt: number;
  text?: string;
  toolName?: string;
  status?: string;
  detail?: string;
}

export interface MobileSessionDetailProps {
  title: string;
  items: ConversationEntry[];
  onBack: () => void;
  canOpenTerminal: boolean;
  onOpenTerminal: () => void;
}

const ROLE_KEY: Record<ConversationEntry['kind'], string> = {
  user: 'mobile.roleUser',
  assistant: 'mobile.roleAssistant',
  reasoning: 'mobile.roleAssistant',
  'tool-call': 'mobile.roleTool',
  approval: 'mobile.roleSystem',
  artifact: 'mobile.roleSystem',
  'system-event': 'mobile.roleSystem',
};

/**
 * A session's conversation, read on a phone.
 *
 * This is the structured record, not the terminal: the same exchange without
 * cursor moves and colour codes, which is the only form of it that fits a
 * 390px screen. The raw pty is one tap away for when the shape matters.
 */
export function MobileSessionDetail({ title, items, onBack, canOpenTerminal, onOpenTerminal }: MobileSessionDetailProps) {
  const { t } = useTranslation();
  const endRef = useRef<HTMLDivElement>(null);
  const count = items.length;

  // Follow the tail as new turns arrive — a session being watched live is read
  // from the bottom, and scrolling back up by hand every refresh is unusable.
  useEffect(() => {
    // Guarded: jsdom has no scrollIntoView, and neither do some embedded
    // webviews — failing to follow the tail must not blank the screen.
    const end = endRef.current;
    if (typeof end?.scrollIntoView === 'function') end.scrollIntoView({ block: 'end' });
  }, [count]);

  return (
    <div style={screen}>
      <div style={topBar}>
        <button style={{ ...secondaryButton, padding: '0 12px' }} onClick={onBack}>{t('mobile.back')}</button>
        <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      </div>

      <div style={{ ...body, paddingBottom: canOpenTerminal ? 88 : 24 }}>
        {items.length === 0 ? (
          <p style={{ color: COLORS.muted, fontSize: 14, textAlign: 'center', marginTop: 48 }}>{t('mobile.conversationEmpty')}</p>
        ) : (
          items.map((item) => (
            <div key={item.itemId} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>
                {t(ROLE_KEY[item.kind])}
                {item.toolName ? ` · ${item.toolName}` : ''}
                {item.status ? ` · ${item.status}` : ''}
              </div>
              <div
                style={{
                  background: item.kind === 'user' ? 'transparent' : COLORS.surface,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 10, padding: '10px 12px', fontSize: 14, lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}
              >
                {item.text ?? item.detail ?? item.toolName ?? '—'}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {canOpenTerminal && (
        <div style={actionBar}>
          <button style={primaryButton} onClick={onOpenTerminal}>{t('mobile.openTerminal')}</button>
        </div>
      )}
    </div>
  );
}

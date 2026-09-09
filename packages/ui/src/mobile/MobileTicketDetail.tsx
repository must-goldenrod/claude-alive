import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ticket } from '@claude-alive/core';
import { displayStatus, STATUS_COLOR, projectName, parseDecisionOptions } from '../views/tickets/ticketDisplay.ts';
import { COLORS, screen, topBar, body, primaryButton, secondaryButton, actionBar, input, label } from './styles.ts';
import type { MobileReplyFn } from './types.ts';

export interface MobileTicketDetailProps {
  ticket: Ticket;
  onBack: () => void;
  onReply: MobileReplyFn;
  onCancel: () => void;
  onRetry: () => void;
}

const SETTLED = new Set(['done', 'failed']);

/**
 * One ticket, read and answered.
 *
 * A parked question is put above the result rather than below it: when a ticket
 * is in `decision` the agent has stopped and the only thing that matters is the
 * answer. The options the agent listed become taps that fill the box — on a
 * phone, retyping "A안으로" is the difference between answering now and later.
 */
export function MobileTicketDetail({ ticket, onBack, onReply, onCancel, onRetry }: MobileTicketDetailProps) {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);

  const status = displayStatus(ticket.state);
  const waiting = ticket.state === 'decision';
  const settled = SETTLED.has(ticket.state);
  const decision = waiting && ticket.decisionQuestion ? parseDecisionOptions(ticket.decisionQuestion) : null;

  const send = async () => {
    const text = answer.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await onReply(text);
    setSending(false);
    if (ok) setAnswer('');
  };

  return (
    <div style={screen}>
      <div style={topBar}>
        <button style={{ ...secondaryButton, padding: '0 12px' }} onClick={onBack}>{t('mobile.back')}</button>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: STATUS_COLOR[status], flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: COLORS.muted }}>#{ticket.seq} · {projectName(ticket.cwd)}</span>
      </div>

      <div style={body}>
        <p style={{ fontSize: 16, lineHeight: 1.5, margin: '0 0 20px' }}>{ticket.goal}</p>

        {waiting && (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.accent}`, borderRadius: 12, padding: 14, marginBottom: 20 }}>
            <span style={label}>{t('mobile.questionLabel')}</span>
            <p style={{ fontSize: 15, lineHeight: 1.6, margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>
              {decision?.prompt ?? ticket.decisionQuestion}
            </p>
            {decision?.options.map((option) => (
              <button
                key={option.key}
                // Tapping fills the box rather than sending: the agent's options
                // are a starting point and the answer is often "B, but only for
                // the API" — which is unreachable if the tap is the send.
                onClick={() => setAnswer(`${option.key}. ${option.text}`)}
                style={{ ...secondaryButton, display: 'block', width: '100%', textAlign: 'left', marginBottom: 6, padding: '10px 12px', minHeight: 44, lineHeight: 1.4 }}
              >
                <b>{option.key}.</b> {option.text}
              </button>
            ))}
            <textarea
              value={answer}
              rows={3}
              placeholder={t('mobile.answerPlaceholder')}
              onChange={(e) => setAnswer(e.target.value)}
              style={{ ...input, marginTop: 8, resize: 'vertical' }}
            />
            <button
              style={{ ...primaryButton, marginTop: 8, opacity: answer.trim() && !sending ? 1 : 0.4 }}
              onClick={send}
            >
              {sending ? t('mobile.sending') : t('mobile.send')}
            </button>
          </div>
        )}

        {ticket.headline && (
          <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, margin: '0 0 10px' }}>{ticket.headline}</p>
        )}
        <span style={label}>{t('mobile.resultLabel')}</span>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14 }}>
          {ticket.result ? (
            <pre style={{ margin: 0, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-ui, system-ui)' }}>
              {ticket.result}
            </pre>
          ) : (
            <span style={{ fontSize: 13, color: COLORS.muted }}>{t('mobile.noResult')}</span>
          )}
        </div>
      </div>

      <div style={actionBar}>
        {settled ? (
          <button style={{ ...secondaryButton, flex: 1 }} onClick={onRetry}>{t('mobile.retryTicket')}</button>
        ) : (
          <button style={{ ...secondaryButton, flex: 1 }} onClick={onCancel}>{t('mobile.cancelTicket')}</button>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ticket, TicketEvaluation, EvalLabel } from '@claude-alive/core';
import { Markdown } from './Markdown.tsx';
import { projectName, formatStarted, statusGroup, formatTokens, formatCost, formatDuration } from './ticketDisplay.ts';
import type { EvaluateFn } from './useTickets.ts';

interface TicketDetailModalProps {
  ticket: Ticket;
  evaluation?: TicketEvaluation | null;
  onClose: () => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onEvaluate?: EvaluateFn;
}

export function TicketDetailModal({ ticket, evaluation, onClose, onRetry, onCancel, onDelete, onEvaluate }: TicketDetailModalProps) {
  const { t } = useTranslation();
  const group = statusGroup(ticket.state);
  const isActive = group === 'active';

  // ESC closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta: string[] = [formatStarted(ticket)];
  if (ticket.model) meta.push(ticket.model);
  if (ticket.thinking) meta.push('thinking');
  if (ticket.effort) meta.push(`effort:${ticket.effort}`);

  // Jump from the ticket into the live intervention surface (animation/terminal)
  // focused on this ticket's Claude session. Reuses the app-level event handlers
  // (`claude-alive:navigate` + `terminal:focusTab`) — no new wiring needed. Only
  // possible when the runner captured the underlying session id.
  const handleIntervene = () => {
    if (!ticket.claudeSessionId) return;
    window.dispatchEvent(new CustomEvent('claude-alive:navigate', { detail: { mode: 'animation' } }));
    window.dispatchEvent(
      new CustomEvent('terminal:focusTab', { detail: { sessionId: ticket.claudeSessionId } }),
    );
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary, #161b22)',
          border: '1px solid var(--border-default, #30363d)',
          borderRadius: 14,
          width: 'min(760px, 100%)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border-default, #30363d)' }}>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, opacity: 0.6 }}>#{ticket.seq}</span>
          <span style={badgeStyle}>{projectName(ticket.cwd)}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, fontFamily: 'var(--font-mono, monospace)', opacity: 0.6 }}>
            {meta.join(' · ')}
          </span>
          <button type="button" onClick={onClose} style={{ ...btnStyle, padding: '4px 10px' }}>
            {t('tickets.close')}
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto' }}>
          <Section label={t('tickets.goalLabel')}>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary, #e6edf3)' }}>{ticket.goal}</div>
          </Section>

          {ticket.headline && (
            <Section label={t('tickets.headlineLabel')}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent-blue, #58a6ff)' }}>{ticket.headline}</div>
            </Section>
          )}

          {ticket.state === 'failed' && (
            <Section label={t('tickets.failureLabel')}>
              <div style={{ fontSize: 13, color: 'var(--accent-red, #f85149)', lineHeight: 1.5 }}>
                {ticket.failureReason ? t(`tickets.failureReason.${ticket.failureReason}`) : ''}
                {ticket.error ? `: ${ticket.error}` : ''}
              </div>
            </Section>
          )}

          {ticket.result && (
            <Section label={t('tickets.resultLabel')}>
              <Markdown text={ticket.result} />
            </Section>
          )}

          {ticket.verification && (
            <Section label={t('tickets.verificationLabel')}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)', lineHeight: 1.5 }}>
                {ticket.verification.passed ? '✓ ' : '✗ '}
                {ticket.verification.reason}
              </div>
            </Section>
          )}

          {(ticket.model || ticket.usage) && (
            <Section label={t('tickets.runInfoLabel')}>
              <RunInfo ticket={ticket} t={t} />
            </Section>
          )}

          {evaluation && onEvaluate && (
            <Section label={t('tickets.evaluateLabel')}>
              <EvalSection ticketId={ticket.id} evaluation={evaluation} onEvaluate={onEvaluate} t={t} />
            </Section>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border-default, #30363d)' }}>
          {ticket.claudeSessionId && (
            <button
              type="button"
              onClick={handleIntervene}
              style={{
                ...btnStyle,
                color: 'var(--accent-blue, #58a6ff)',
                borderColor: 'var(--accent-blue, #58a6ff)',
                background: 'rgba(88, 166, 255, 0.10)',
              }}
            >
              {t('tickets.intervene')}
            </button>
          )}
          {isActive && (
            <button type="button" onClick={() => onCancel(ticket.id)} style={btnStyle}>
              {t('tickets.cancel')}
            </button>
          )}
          {ticket.state === 'failed' && (
            <button type="button" onClick={() => onRetry(ticket.id)} style={btnStyle}>
              {t('tickets.retry')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onDelete(ticket.id);
              onClose();
            }}
            style={{ ...btnStyle, marginLeft: 'auto', color: 'var(--accent-red, #f85149)', borderColor: 'var(--accent-red, #f85149)' }}
          >
            {t('tickets.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Human good/bad labelling for a settled ticket. Clicking Good/Bad saves
 * immediately with the current weight + note; the label feeds the project's
 * learned guide (guideSynthesizer on the server).
 */
function EvalSection({
  ticketId,
  evaluation,
  onEvaluate,
  t,
}: {
  ticketId: string;
  evaluation: TicketEvaluation;
  onEvaluate: EvaluateFn;
  t: (key: string) => string;
}) {
  const [weight, setWeight] = useState(evaluation.weight);
  const [note, setNote] = useState(evaluation.note ?? '');
  const [saving, setSaving] = useState<EvalLabel | null>(null);
  const [savedAt, setSavedAt] = useState(0);

  const save = async (label: EvalLabel) => {
    setSaving(label);
    const result = await onEvaluate(ticketId, { label, weight, note: note.trim() || undefined });
    setSaving(null);
    if (result) setSavedAt(Date.now());
  };

  const labelBtn = (label: EvalLabel, accent: string): React.CSSProperties => {
    const on = evaluation.label === label;
    return {
      ...btnStyle,
      color: on ? '#fff' : accent,
      borderColor: accent,
      background: on ? accent : 'transparent',
      opacity: saving && saving !== label ? 0.5 : 1,
      cursor: saving ? 'wait' : 'pointer',
    };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" disabled={!!saving} onClick={() => save('good')} style={labelBtn('good', 'var(--accent-green, #3fb950)')}>
          {t('tickets.evalGood')}
        </button>
        <button type="button" disabled={!!saving} onClick={() => save('bad')} style={labelBtn('bad', 'var(--accent-red, #f85149)')}>
          {t('tickets.evalBad')}
        </button>
        {!evaluation.humanLabeled && (
          <span style={{ fontSize: 11, color: 'var(--text-secondary, #8b949e)', opacity: 0.7 }}>
            {t('tickets.evalAuto')}: {evaluation.autoLabel}
          </span>
        )}
        {savedAt > 0 && (
          <span style={{ fontSize: 11, color: 'var(--accent-green, #3fb950)' }}>{t('tickets.evalSaved')}</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary, #8b949e)' }}>{t('tickets.evalWeight')}</span>
        {[1, 2, 3, 4, 5].map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWeight(w)}
            style={{
              ...btnStyle,
              padding: '2px 9px',
              color: weight === w ? 'var(--text-primary, #e6edf3)' : 'var(--text-secondary, #8b949e)',
              background: weight === w ? 'rgba(88,166,255,0.15)' : 'transparent',
              borderColor: weight === w ? 'var(--accent-blue, #58a6ff)' : 'var(--border-default, #30363d)',
            }}
          >
            {w}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('tickets.evalNotePlaceholder')}
        maxLength={2000}
        style={{
          fontSize: 12,
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid var(--border-default, #30363d)',
          background: 'var(--bg-tertiary, #21262d)',
          color: 'var(--text-primary, #e6edf3)',
        }}
      />
    </div>
  );
}

/** Model, reasoning effort, and token/cost/turn accounting for the run. */
function RunInfo({ ticket, t }: { ticket: Ticket; t: (key: string) => string }) {
  const u = ticket.usage;
  const rows: [string, string][] = [];
  if (ticket.model) rows.push([t('tickets.runModel'), ticket.model]);
  if (ticket.effort) rows.push([t('tickets.runEffort'), ticket.effort]);
  if (ticket.thinking) rows.push([t('tickets.runThinking'), 'on']);
  if (u) {
    const tok = (n?: number) => formatTokens(n) ?? '—';
    if (u.inputTokens !== undefined) rows.push([t('tickets.runInput'), tok(u.inputTokens)]);
    if (u.outputTokens !== undefined) rows.push([t('tickets.runOutput'), tok(u.outputTokens)]);
    if (u.cacheReadTokens !== undefined) rows.push([t('tickets.runCacheRead'), tok(u.cacheReadTokens)]);
    if (u.cacheCreationTokens !== undefined) rows.push([t('tickets.runCacheCreate'), tok(u.cacheCreationTokens)]);
    if (u.totalTokens !== undefined) rows.push([t('tickets.runTotal'), tok(u.totalTokens)]);
    const cost = formatCost(u.costUsd);
    if (cost) rows.push([t('tickets.runCost'), cost]);
    if (u.numTurns !== undefined) rows.push([t('tickets.runTurns'), String(u.numTurns)]);
    const dur = formatDuration(u.durationMs);
    if (dur) rows.push([t('tickets.runDuration'), dur]);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 16, rowGap: 5 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)' }}>{k}</span>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary, #e6edf3)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary, #8b949e)', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--accent-blue, #58a6ff)',
  background: 'color-mix(in srgb, var(--accent-blue, #58a6ff) 15%, transparent)',
  borderRadius: 6,
  padding: '2px 8px',
};

const btnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-default, #30363d)',
  background: 'var(--bg-tertiary, #21262d)',
  color: 'var(--text-secondary, #8b949e)',
  cursor: 'pointer',
};

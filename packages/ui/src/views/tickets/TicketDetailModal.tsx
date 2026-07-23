import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ticket, TicketEvaluation, TicketTurn, TicketDelegation, EvalLabel } from '@claude-alive/core';
import { Markdown } from './Markdown.tsx';
import {
  projectName,
  formatStarted,
  STATUS_COLOR,
  formatTokens,
  formatCost,
  formatDuration,
  parseDecisionOptions,
  type DecisionOption,
} from './ticketDisplay.ts';
import type { EvaluateFn, ReplyFn } from './useTickets.ts';

interface TicketDetailModalProps {
  ticket: Ticket;
  evaluation?: TicketEvaluation | null;
  onClose: () => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onEvaluate?: EvaluateFn;
  /** Submit a follow-up prompt for a decision ticket; resolves true on success. */
  onReply?: ReplyFn;
}

export function TicketDetailModal({ ticket, evaluation, onClose, onRetry, onCancel, onDelete, onEvaluate, onReply }: TicketDetailModalProps) {
  const { t } = useTranslation();
  const isActive = ticket.state === 'queued' || ticket.state === 'running' || ticket.state === 'verifying';
  const isDecision = ticket.state === 'decision';
  const decisionColor = STATUS_COLOR.decision;
  const turns = ticket.turns ?? [];

  // Lifted so a click on a decision option can pre-fill the reply composer.
  const [replyText, setReplyText] = useState('');

  // The trailing turn is always surfaced by a dedicated panel below the thread:
  // a pending decision by the DecisionPanel, and a settled result by the Markdown
  // result section. Either way, drop it from the history thread so the same
  // content is never shown twice (and the final result renders as full markdown,
  // not a truncated pre-wrap chat bubble).
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : undefined;
  const dropsTrailing =
    !!lastTurn && (isDecision ? lastTurn.kind === 'decision' : lastTurn.kind === 'result');
  const threadTurns = dropsTrailing ? turns.slice(0, -1) : turns;
  const hasConversation = threadTurns.some((tn) => tn.role === 'user');
  // Show the history thread only when there is genuine back-and-forth or multiple
  // rounds; a first pending decision has no history worth a thread.
  const showThread = threadTurns.length > 0 && (hasConversation || (ticket.rounds ?? 1) > 1);
  // Always render the agent's latest result/context as markdown — including after
  // a decision-driven completion, where the thread above carries only the prior
  // back-and-forth. The decision panel (when pending) lives separately at the bottom.
  const showResult = !!ticket.result;
  const decision = isDecision && ticket.decisionQuestion ? parseDecisionOptions(ticket.decisionQuestion) : null;

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
          <button
            type="button"
            onClick={onClose}
            aria-label={t('tickets.close')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary, #8b949e)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: '2px 6px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto' }}>
          <Section label={t('tickets.goalLabel')}>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary, #e6edf3)' }}>{ticket.goal}</div>
          </Section>

          {showThread && (
            <Section label={t('tickets.threadLabel')}>
              <Thread turns={threadTurns} t={t} />
            </Section>
          )}

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

          {showResult && (
            <Section label={t('tickets.resultLabel')}>
              <Markdown text={ticket.result ?? ''} />
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

          {ticket.delegations && ticket.delegations.length > 0 && (
            <Section label={t('tickets.delegationsLabel')}>
              <Delegations delegations={ticket.delegations} />
            </Section>
          )}

          {evaluation && onEvaluate && (
            <Section label={t('tickets.evaluateLabel')}>
              <EvalSection ticketId={ticket.id} evaluation={evaluation} onEvaluate={onEvaluate} onClose={onClose} t={t} />
            </Section>
          )}

          {/* The decision itself lives at the bottom, after all the context above. */}
          {decision && (
            <Section label={t('tickets.decisionLabel')}>
              <DecisionPanel
                decision={decision}
                color={decisionColor}
                pickable={!!onReply}
                onPick={(o) => setReplyText(`${o.key}) ${o.text}`)}
                t={t}
              />
            </Section>
          )}
        </div>

        {/* Reply composer — only while a decision is pending */}
        {isDecision && onReply && (
          <ReplyComposer
            ticketId={ticket.id}
            color={decisionColor}
            value={replyText}
            onChange={setReplyText}
            onReply={onReply}
            t={t}
          />
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border-default, #30363d)' }}>
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
 * One-click human rating for a settled ticket: a single 5-point scale that
 * encodes both the label (good/bad/neutral) and its weight (intensity). Clicking
 * any point saves immediately with the optional note and closes the modal — the
 * label feeds the project's learned guide (guideSynthesizer on the server).
 */
const EVAL_SCALE: { key: string; label: EvalLabel; weight: number; accent: string }[] = [
  { key: 'tickets.evalVeryBad', label: 'bad', weight: 5, accent: 'var(--accent-red, #f85149)' },
  { key: 'tickets.evalBad', label: 'bad', weight: 3, accent: 'var(--accent-red, #f85149)' },
  { key: 'tickets.evalNeutral', label: 'unrated', weight: 1, accent: 'var(--text-secondary, #8b949e)' },
  { key: 'tickets.evalGood', label: 'good', weight: 3, accent: 'var(--accent-green, #3fb950)' },
  { key: 'tickets.evalVeryGood', label: 'good', weight: 5, accent: 'var(--accent-green, #3fb950)' },
];

function EvalSection({
  ticketId,
  evaluation,
  onEvaluate,
  onClose,
  t,
}: {
  ticketId: string;
  evaluation: TicketEvaluation;
  onEvaluate: EvaluateFn;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const [saving, setSaving] = useState(false);

  // One-cue: save the label+weight in a single click, then close.
  const commit = async (label: EvalLabel, weight: number) => {
    if (saving) return;
    setSaving(true);
    const result = await onEvaluate(ticketId, { label, weight });
    setSaving(false);
    if (result) onClose();
  };

  const isCurrent = (label: EvalLabel, weight: number) =>
    evaluation.humanLabeled && evaluation.label === label && evaluation.weight === weight;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {EVAL_SCALE.map((s) => {
          const on = isCurrent(s.label, s.weight);
          return (
            <button
              key={s.key}
              type="button"
              disabled={saving}
              onClick={() => commit(s.label, s.weight)}
              title={t(s.key)}
              style={{
                ...btnStyle,
                flex: 1,
                padding: '9px 4px',
                fontWeight: 600,
                textAlign: 'center',
                color: on ? '#0d1117' : s.accent,
                borderColor: s.accent,
                background: on ? s.accent : `color-mix(in srgb, ${s.accent} 10%, transparent)`,
                cursor: saving ? 'wait' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {t(s.key)}
            </button>
          );
        })}
      </div>

      {!evaluation.humanLabeled && (
        <span style={{ fontSize: 11, color: 'var(--text-secondary, #8b949e)', opacity: 0.7 }}>
          {t('tickets.evalAuto')}: {evaluation.autoLabel}
        </span>
      )}
    </div>
  );
}

/** Model, reasoning effort, and token/cost/turn accounting for the run. */
function RunInfo({ ticket, t }: { ticket: Ticket; t: (key: string) => string }) {
  const u = ticket.usage;
  const rows: [string, string][] = [];
  if (ticket.rounds && ticket.rounds > 1) rows.push([t('tickets.runRounds'), String(ticket.rounds)]);
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

/**
 * Sub-agent delegations made by the orchestrator. Makes the "which models did
 * this actually use" question answerable — each row is one ca-delegate call,
 * with the target model, its token cost, and the prompt that was handed off.
 */
function Delegations({ delegations }: { delegations: TicketDelegation[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {delegations.map((d, i) => {
        const tok = formatTokens(d.totalTokens);
        const cost = formatCost(d.costUsd);
        const meta = [tok ? `${tok} tok` : null, cost].filter(Boolean).join(' · ');
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'var(--bg-tertiary, #161b22)',
              border: '1px solid var(--border-default, #30363d)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--accent-blue, #58a6ff)' }}>
                {d.model}
              </span>
              {meta && (
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary, #8b949e)' }}>
                  {meta}
                </span>
              )}
            </div>
            {d.promptPreview && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)', lineHeight: 1.4 }}>
                {d.promptPreview}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Conversation thread: agent results/decisions and the user's replies, in order. */
function Thread({ turns, t }: { turns: TicketTurn[]; t: (key: string) => string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {turns.map((turn, i) => {
        const isUser = turn.role === 'user';
        const accent =
          turn.kind === 'decision'
            ? STATUS_COLOR.decision
            : isUser
              ? 'var(--accent-blue, #58a6ff)'
              : 'var(--accent-green, #3fb950)';
        const roleKey = isUser ? 'tickets.threadUser' : turn.kind === 'decision' ? 'tickets.threadDecision' : 'tickets.threadAgent';
        return (
          <div key={i} style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '88%', minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: accent, marginBottom: 3, textAlign: isUser ? 'right' : 'left' }}>
              {t(roleKey)}
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                padding: '8px 12px',
                borderRadius: 10,
                background: isUser ? 'rgba(88,166,255,0.10)' : 'var(--bg-tertiary, #21262d)',
                border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
                color: 'var(--text-primary, #e6edf3)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {turn.headline && (
                <div style={{ fontWeight: 600, color: accent, marginBottom: turn.text ? 4 : 0 }}>{turn.headline}</div>
              )}
              {turn.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The pending decision, shown at the bottom of the modal: the question stem
 * followed by each labeled option wrapped in its own card so the choices are
 * easy to tell apart. When a reply is possible, clicking a card pre-fills the
 * composer with that choice (the human still confirms before sending).
 */
function DecisionPanel({
  decision,
  color,
  pickable,
  onPick,
  t,
}: {
  decision: { prompt: string; options: DecisionOption[] };
  color: string;
  pickable: boolean;
  onPick: (option: DecisionOption) => void;
  t: (key: string) => string;
}) {
  const { prompt, options } = decision;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {prompt && (
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.5,
            color,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            borderRadius: 10,
            padding: '10px 12px',
          }}
        >
          {prompt}
        </div>
      )}

      {options.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={pickable ? () => onPick(o) : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid color-mix(in srgb, ${color} 35%, var(--border-default, #30363d))`,
                background: 'var(--bg-tertiary, #21262d)',
                color: 'var(--text-primary, #e6edf3)',
                cursor: pickable ? 'pointer' : 'default',
                transition: 'background-color 0.15s ease, border-color 0.15s ease, transform 0.12s ease',
              }}
              onMouseEnter={(e) => {
                if (!pickable) return;
                e.currentTarget.style.background = `color-mix(in srgb, ${color} 14%, transparent)`;
                e.currentTarget.style.borderColor = color;
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                if (!pickable) return;
                e.currentTarget.style.background = 'var(--bg-tertiary, #21262d)';
                e.currentTarget.style.borderColor = `color-mix(in srgb, ${color} 35%, var(--border-default, #30363d))`;
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 24,
                  height: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 7,
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono, monospace)',
                  color: '#0d1117',
                  background: color,
                }}
              >
                {o.key}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.5, minWidth: 0, wordBreak: 'break-word' }}>{o.text}</span>
            </button>
          ))}
        </div>
      )}

      {pickable && options.length > 0 && (
        <span style={{ fontSize: 11, color: 'var(--text-secondary, #8b949e)', opacity: 0.75 }}>
          {t('tickets.decisionPickHint')}
        </span>
      )}
    </div>
  );
}

/** Follow-up input for a pending decision: submits a reply that resumes the run. */
function ReplyComposer({
  ticketId,
  color,
  value,
  onChange,
  onReply,
  t,
}: {
  ticketId: string;
  color: string;
  value: string;
  onChange: (text: string) => void;
  onReply: ReplyFn;
  t: (key: string) => string;
}) {
  const [sending, setSending] = useState(false);
  const canSend = value.trim().length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    const ok = await onReply(ticketId, value.trim());
    setSending(false);
    if (ok) onChange('');
  };

  return (
    <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border-default, #30363d)', alignItems: 'flex-end' }}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('tickets.decisionAnswer')}
        rows={2}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send();
        }}
        style={{
          flex: 1,
          resize: 'vertical',
          fontSize: 13,
          fontFamily: 'var(--font-ui, system-ui)',
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--border-default, #30363d)',
          background: 'var(--bg-primary, #0d1117)',
          color: 'var(--text-primary, #e6edf3)',
        }}
      />
      <button
        type="button"
        onClick={() => void send()}
        disabled={!canSend}
        style={{
          fontSize: 13,
          fontWeight: 600,
          padding: '8px 16px',
          borderRadius: 8,
          border: 'none',
          background: canSend ? color : 'var(--bg-tertiary, #21262d)',
          color: canSend ? '#0d1117' : 'var(--text-secondary, #8b949e)',
          cursor: canSend ? 'pointer' : 'not-allowed',
          whiteSpace: 'nowrap',
        }}
      >
        {sending ? t('tickets.sending') : t('tickets.send')}
      </button>
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

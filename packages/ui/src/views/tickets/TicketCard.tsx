import { useTranslation } from 'react-i18next';
import { useNow } from '../dashboard/hooks/useNow.ts';
import { formatAge } from '../../utils/age.ts';
import type { Ticket, TicketEvaluation, SshTarget } from '@claude-alive/core';

/** `dev@host` / `host:port` — inlined (avoid a core runtime import in the browser bundle). */
function sshDisplay(t: SshTarget): string {
  const at = t.user ? `${t.user}@${t.host}` : t.host;
  return t.port && t.port !== 22 ? `${at}:${t.port}` : at;
}
import {
  projectName,
  formatStarted,
  ticketLastActivityAt,
  displayStatus,
  oneLineSummary,
  runMetaShort,
  STATUS_COLOR,
  reviewPhase,
  reviewPhaseKey,
  REVIEW_PHASE_BORDER,
  type DisplayStatus,
} from './ticketDisplay.ts';
import { failureLine } from './failureLine.ts';

interface TicketCardProps {
  ticket: Ticket;
  evaluation?: TicketEvaluation | null;
  onOpen: (ticket: Ticket) => void;
}

/** Every card is the same height so lanes stay a tidy grid regardless of content. */
const CARD_HEIGHT = 150;

/**
 * One ticket at a glance, and nothing more.
 *
 * The card is read-only on purpose. It used to carry its own Good/Bad buttons,
 * which meant evaluating happened in two places with different surrounding
 * context — from the board you could label a ticket without having read its
 * result. Every action now lives in the detail modal, and the whole card is the
 * one control that opens it.
 */
export function TicketCard({ ticket, evaluation, onOpen }: TicketCardProps) {
  const { t } = useTranslation();
  const now = useNow();
  const status = displayStatus(ticket.state, evaluation);
  // Started-at alone cannot tell a stalled ticket from a live one. The card now
  // leads with how long it has been quiet and keeps the start time as a tooltip.
  const lastActivity = ticketLastActivityAt(ticket);
  const color = STATUS_COLOR[status];
  const isActive = status === 'active';
  // The border carries the review state (검증/의사결정), which is a different
  // question from the column the card sits in — see reviewPhase().
  const phase = reviewPhase(ticket);
  const phaseBorder = REVIEW_PHASE_BORDER[phase];
  const phaseSettling = phase === 'verifying' || phase === 'decisionRunning';

  // Focal line: the one-line result. While active, show the live sub-status;
  // on failure, the reason; otherwise the headline/derived summary.
  const line =
    status === 'active'
      ? t(`tickets.status.${ticket.state}`) + '…'
      : status === 'decision'
        ? ticket.decisionQuestion ?? t('tickets.decisionPending')
        : status === 'failed'
          ? failureLine(ticket, t)
          : oneLineSummary(ticket) ?? t('tickets.noResult');

  const meta = runMetaShort(ticket);

  return (
    <div
      onClick={() => onOpen(ticket)}
      role="button"
      tabIndex={0}
      className={isActive ? 'ticket-card--active' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(ticket);
        }
      }}
      style={{
        height: CARD_HEIGHT,
        boxSizing: 'border-box',
        // Active cards get their surface + flowing rainbow border from the
        // `.ticket-card--active` class; static statuses keep the left accent.
        background: 'var(--bg-secondary, #161b22)',
        border: `1px solid ${phaseBorder}`,
        boxShadow: isActive ? 'none' : `inset 3px 0 0 ${color}`,
        borderRadius: 12,
        padding: '12px 14px 12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: 'pointer',
        transition: 'transform 0.12s ease, border-color 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        if (!isActive) {
          e.currentTarget.style.background = 'var(--bg-tertiary, #1c2230)';
          e.currentTarget.style.borderColor = `color-mix(in srgb, ${phaseBorder} 70%, var(--border-default, #30363d))`;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        if (!isActive) {
          e.currentTarget.style.background = 'var(--bg-secondary, #161b22)';
          e.currentTarget.style.borderColor = phaseBorder;
        }
      }}
    >
      {/* top row: #seq + project badge ............... time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, opacity: 0.55, flexShrink: 0 }}>#{ticket.seq}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--accent-blue, #58a6ff)',
            background: 'color-mix(in srgb, var(--accent-blue, #58a6ff) 15%, transparent)',
            borderRadius: 6,
            padding: '1px 7px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
          title={ticket.cwd}
        >
          {projectName(ticket.cwd)}
        </span>
        {ticket.location?.kind === 'ssh' && ticket.location.ssh && (
          <span
            title={sshDisplay(ticket.location.ssh)}
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--accent-purple, #bc8cff)',
              background: 'color-mix(in srgb, var(--accent-purple, #bc8cff) 15%, transparent)',
              borderRadius: 6,
              padding: '1px 6px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            ⬈ {ticket.location.label || ticket.location.ssh.host}
          </span>
        )}
        <span
          data-testid={`ticket-age-${ticket.id}`}
          title={`${t('tickets.startedAt')}: ${formatStarted(ticket)} / ${new Date(lastActivity).toLocaleString()}`}
          style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono, monospace)', opacity: 0.45, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {t('sidebar.lastActivity', { age: formatAge(Math.max(0, now - lastActivity)) })}
        </span>
      </div>

      {/* goal (what was asked), muted — one line */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-secondary, #8b949e)',
          lineHeight: 1.35,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
        title={ticket.goal}
      >
        {ticket.goal}
      </div>

      {/* one-line result — the focal point, clamped to two lines to keep height uniform */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          fontSize: 13.5,
          fontWeight: 600,
          color,
          lineHeight: 1.35,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {/* Active tickets: sweep a highlight across the status text so it reads
            as live, running work. Other statuses render as plain colored text. */}
        {isActive ? <span className="ticket-status-run">{line}</span> : line}
      </div>

      {/* footer — always a single row so cards line up */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minWidth: 0 }}>
        <StatusChip status={status} label={t(`tickets.columns.${status}`)} />
        {/* Text equivalent of the border, so the review state survives color
            blindness and a greyscale screenshot. */}
        {phase !== 'unverified' && phase !== 'failed' && (
          <span
            data-testid={`ticket-phase-${ticket.id}`}
            title={t(reviewPhaseKey(phase))}
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: phaseBorder,
              border: `1px solid ${phaseBorder}`,
              borderRadius: 5,
              padding: '1px 5px',
              flexShrink: 0,
              ...(phaseSettling ? { animation: 'pulse 1.4s infinite' } : {}),
            }}
          >
            {t(reviewPhaseKey(phase))}
          </span>
        )}
        {/* Read-only cues only. `complete` says a decision is waiting for you and
            `decision` says an answer is; both are answered inside the modal. */}
        {(status === 'complete' || status === 'decision') && (
          <span
            data-testid={`ticket-cta-${ticket.id}`}
            style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}
          >
            {status === 'decision' ? t('tickets.answerCta') : t('tickets.reviewCta')} →
          </span>
        )}
        {status === 'closed' && evaluation && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: evaluation.label === 'good' ? 'var(--accent-green, #3fb950)' : 'var(--accent-red, #f85149)',
              flexShrink: 0,
            }}
          >
            {evaluation.label === 'good' ? t('tickets.evalGood') : t('tickets.evalBad')}
          </span>
        )}
        {meta && status !== 'complete' && status !== 'decision' && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              fontFamily: 'var(--font-mono, monospace)',
              opacity: 0.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
            title={meta}
          >
            {meta}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status, label }: { status: DisplayStatus; label: string }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        borderRadius: 6,
        padding: '2px 8px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
      }}
    >
      {status === 'active' && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, animation: 'pulse 1.4s infinite' }} />
      )}
      {status === 'closed' && '✓'}
      {label}
    </span>
  );
}


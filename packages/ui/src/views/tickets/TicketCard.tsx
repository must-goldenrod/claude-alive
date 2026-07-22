import { useTranslation } from 'react-i18next';
import type { Ticket, TicketEvaluation, SshTarget } from '@claude-alive/core';

/** `dev@host` / `host:port` — inlined (avoid a core runtime import in the browser bundle). */
function sshDisplay(t: SshTarget): string {
  const at = t.user ? `${t.user}@${t.host}` : t.host;
  return t.port && t.port !== 22 ? `${at}:${t.port}` : at;
}
import {
  projectName,
  formatStarted,
  displayStatus,
  oneLineSummary,
  runMetaShort,
  STATUS_COLOR,
  type DisplayStatus,
} from './ticketDisplay.ts';
import type { EvaluateFn } from './useTickets.ts';

interface TicketCardProps {
  ticket: Ticket;
  evaluation?: TicketEvaluation | null;
  onOpen: (ticket: Ticket) => void;
  onEvaluate?: EvaluateFn;
}

/** Every card is the same height so lanes stay a tidy grid regardless of content. */
const CARD_HEIGHT = 150;

export function TicketCard({ ticket, evaluation, onOpen, onEvaluate }: TicketCardProps) {
  const { t } = useTranslation();
  const status = displayStatus(ticket.state, evaluation);
  const color = STATUS_COLOR[status];
  const isActive = status === 'active';

  // Focal line: the one-line result. While active, show the live sub-status;
  // on failure, the reason; otherwise the headline/derived summary.
  const line =
    status === 'active'
      ? t(`tickets.status.${ticket.state}`) + '…'
      : status === 'failed'
        ? ticket.failureReason
          ? t(`tickets.failureReason.${ticket.failureReason}`)
          : t('tickets.status.failed')
        : oneLineSummary(ticket) ?? t('tickets.noResult');

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const doEval = (e: React.MouseEvent, label: 'good' | 'bad') => {
    e.stopPropagation();
    onEvaluate?.(ticket.id, { label });
  };

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
        border: '1px solid var(--border-default, #30363d)',
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
          e.currentTarget.style.borderColor = `color-mix(in srgb, ${color} 45%, var(--border-default, #30363d))`;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        if (!isActive) {
          e.currentTarget.style.background = 'var(--bg-secondary, #161b22)';
          e.currentTarget.style.borderColor = 'var(--border-default, #30363d)';
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
        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono, monospace)', opacity: 0.45, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {formatStarted(ticket)}
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
        {line}
      </div>

      {/* footer — always a single row so cards line up */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minWidth: 0 }}>
        <StatusChip status={status} label={t(`tickets.columns.${status}`)} />
        {status === 'complete' && onEvaluate ? (
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
            <button type="button" onClick={(e) => doEval(e, 'good')} style={evalBtn('var(--accent-green, #3fb950)')}>
              {t('tickets.evalGood')}
            </button>
            <button type="button" onClick={(e) => doEval(e, 'bad')} style={evalBtn('var(--accent-red, #f85149)')}>
              {t('tickets.evalBad')}
            </button>
          </div>
        ) : (
          <>
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
            {meta && (
              <span
                onClick={stop}
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
          </>
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

function evalBtn(color: string): React.CSSProperties {
  return {
    fontSize: 12,
    padding: '3px 12px',
    borderRadius: 8,
    border: `1px solid ${color}`,
    background: `color-mix(in srgb, ${color} 10%, transparent)`,
    color,
    cursor: 'pointer',
    fontWeight: 600,
  };
}

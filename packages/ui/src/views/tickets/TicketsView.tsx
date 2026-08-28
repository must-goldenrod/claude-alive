import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ticket } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../../App.tsx';
import { useTickets } from './useTickets.ts';
import { TicketCard } from './TicketCard.tsx';
import { NewTicketForm } from './NewTicketForm.tsx';
import { TicketDetailModal } from './TicketDetailModal.tsx';
import { TodoList } from '../unified/TodoList.tsx';
import { displayStatus, STATUS_COLOR, type DisplayStatus } from './ticketDisplay.ts';
import { filterTicketsBySelection, type RunLocationRef } from './ticketFilter.ts';
import type { Selection } from '../../state/selection.ts';
import { OPEN_RUN_EVENT, type OpenRunIntent } from '../../state/openRun.ts';

interface TicketsViewProps {
  active: boolean;
  subscribeRaw: RawMessageSubscribe;
  /** Sidebar filter. Narrows the board to one repo/worktree. */
  selection: Selection;
  /** Run records, used to decide which repo a ticket belongs to. */
  runs: readonly RunLocationRef[];
  /** Left edge of the shell's content area; the to-do dock starts past it. */
  leftInset: number;
}

const COLUMNS: DisplayStatus[] = ['active', 'decision', 'complete', 'closed', 'failed'];

export function TicketsView({ active, subscribeRaw, selection, runs, leftInset }: TicketsViewProps) {
  const { t } = useTranslation();
  const { tickets, evaluations, createTicket, retryTicket, replyTicket, cancelTicket, deleteTicket, evaluateTicket } = useTickets(active, subscribeRaw);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [presetCwd, setPresetCwd] = useState<string | undefined>(undefined);

  // The sidebar's per-worktree "+" routes here rather than opening a second
  // composer, so there stays exactly one way to create a ticket.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { cwd?: string } | undefined;
      if (typeof detail?.cwd === 'string') setPresetCwd(detail.cwd);
    };
    window.addEventListener('claude-alive:new-run', handler);
    return () => window.removeEventListener('claude-alive:new-run', handler);
  }, []);

  // "Open" on a ticket run means this view's detail modal. The shell switches
  // to this view and we pick the ticket up here, where the modal already lives.
  useEffect(() => {
    const handler = (event: Event) => {
      const intent = (event as CustomEvent).detail as OpenRunIntent | undefined;
      if (intent?.kind === 'ticket') setSelectedId(intent.ticketId);
    };
    window.addEventListener(OPEN_RUN_EVENT, handler);
    return () => window.removeEventListener(OPEN_RUN_EVENT, handler);
  }, []);

  const visible = useMemo(
    () => filterTicketsBySelection(tickets, runs, selection),
    [tickets, runs, selection],
  );

  const grouped = useMemo(() => {
    const g: Record<DisplayStatus, Ticket[]> = { active: [], decision: [], complete: [], closed: [], failed: [] };
    for (const ticket of visible) g[displayStatus(ticket.state, evaluations[ticket.id])].push(ticket);
    return g;
  }, [visible, evaluations]);

  // Derive the open ticket from the live list so it reflects state changes.
  const selected = selectedId ? tickets.find((x) => x.id === selectedId) ?? null : null;

  /** Sweep the whole closed lane in one click. Deletion is irreversible, so it
   *  confirms with the exact count first; requests fire in parallel and the WS
   *  broadcast reconciles the board. */
  const clearClosed = useCallback(async () => {
    const targets = grouped.closed;
    if (targets.length === 0) return;
    if (!window.confirm(t('tickets.clearClosedConfirm', { count: targets.length }))) return;
    await Promise.all(targets.map((x) => deleteTicket(x.id)));
  }, [grouped.closed, deleteTicket, t]);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24, boxSizing: 'border-box' }}>
      {/* Detached To-do dock: fixed so it floats independently of the centered
          composer/board frame — it must not push or reflow the existing layout.
          It starts past the repo sidebar rather than at the viewport edge, or it
          would sit on top of it. Lives inside TicketsView so it inherits the
          view's display toggle (hidden on other tabs automatically). */}
      <div style={{ position: 'fixed', top: 72, left: leftInset + 24, width: 300, zIndex: 20 }}>
        <TodoList />
      </div>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Center-focused composer: a ChatGPT-style hero prompt over a
            half-width input, so the "what to solve" question leads the view
            while the board below stays full-width. */}
        <div
          style={{
            maxWidth: 640,
            width: '100%',
            margin: '56px auto 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <h1
            style={{
              margin: 0,
              textAlign: 'center',
              fontSize: 27,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              lineHeight: 1.25,
              color: 'var(--text-primary, #e6edf3)',
              fontFamily: 'var(--font-ui, system-ui)',
            }}
          >
            {t('tickets.heroPrompt')}
          </h1>
          <NewTicketForm onCreate={createTicket} presetCwd={presetCwd} />
        </div>

        {/* Board region: a single bordered surface holds the four status lanes.
            minmax(240px,…) + horizontal scroll keeps lanes from being crushed on
            narrow screens instead of letting them squish. */}
        <div
          style={{
            border: '1px solid var(--border-default, #30363d)',
            borderRadius: 16,
            background: 'var(--bg-primary, #0d1117)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(232px, 1fr))',
              overflowX: 'auto',
            }}
          >
            {COLUMNS.map((col, i) => (
              <div
                key={col}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  padding: 14,
                  minWidth: 0,
                  borderRight: i < COLUMNS.length - 1 ? '1px solid var(--border-color, #21262d)' : 'none',
                }}
              >
                <ColumnHeader
                  status={col}
                  label={t(`tickets.columns.${col}`)}
                  count={grouped[col].length}
                  onClear={col === 'closed' ? clearClosed : undefined}
                />
                {grouped[col].length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.35, padding: '10px 2px', textAlign: 'center' }}>{t('tickets.empty')}</div>
                ) : (
                  grouped[col].map((ticket) => (
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      evaluation={evaluations[ticket.id] ?? null}
                      onOpen={(x) => setSelectedId(x.id)}
                      onEvaluate={evaluateTicket}
                    />
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <TicketDetailModal
          ticket={selected}
          evaluation={evaluations[selected.id] ?? null}
          onClose={() => setSelectedId(null)}
          onRetry={retryTicket}
          onReply={replyTicket}
          onCancel={cancelTicket}
          onDelete={deleteTicket}
          onEvaluate={evaluateTicket}
        />
      )}
    </div>
  );
}

/** Status lane header: a color dot + label + a filled count pill, all tinted by
 *  the lane's status so each column is identifiable at a glance. */
function ColumnHeader({
  status,
  label,
  count,
  onClear,
}: {
  status: DisplayStatus;
  label: string;
  count: number;
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  const color = STATUS_COLOR[status];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        paddingBottom: 10,
        borderBottom: `2px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color, letterSpacing: '0.01em' }}>{label}</span>
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'var(--font-mono, monospace)',
          color,
          background: `color-mix(in srgb, ${color} 16%, transparent)`,
          borderRadius: 999,
          minWidth: 22,
          textAlign: 'center',
          padding: '1px 7px',
        }}
      >
        {count}
      </span>
      {onClear && count > 0 && (
        <button
          type="button"
          onClick={onClear}
          title={t('tickets.clearClosed')}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 6,
            border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            background: 'transparent',
            color: 'var(--text-secondary, #8b949e)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {t('tickets.clearClosed')}
        </button>
      )}
    </div>
  );
}

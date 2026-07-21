import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ticket } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../../App.tsx';

// Local mirror of core's isTicketActive. Kept inline so the UI imports only
// TYPES from the core barrel — a runtime import would pull the barrel's Node-only
// transcript parser (readline) into the browser bundle and break the build.
function isActiveState(state: Ticket['state']): boolean {
  return state === 'queued' || state === 'running' || state === 'verifying';
}
import { useTickets } from './useTickets.ts';
import { TicketCard } from './TicketCard.tsx';
import { NewTicketForm } from './NewTicketForm.tsx';

interface TicketsViewProps {
  active: boolean;
  subscribeRaw: RawMessageSubscribe;
}

type ColumnKey = 'active' | 'done' | 'failed';
const COLUMNS: ColumnKey[] = ['active', 'done', 'failed'];

function columnOf(t: Ticket): ColumnKey {
  if (isActiveState(t.state)) return 'active';
  return t.state === 'done' ? 'done' : 'failed';
}

export function TicketsView({ active, subscribeRaw }: TicketsViewProps) {
  const { t } = useTranslation();
  const { tickets, createTicket, retryTicket, cancelTicket, deleteTicket } = useTickets(active, subscribeRaw);

  const grouped = useMemo(() => {
    const g: Record<ColumnKey, Ticket[]> = { active: [], done: [], failed: [] };
    for (const ticket of tickets) g[columnOf(ticket)].push(ticket);
    return g;
  }, [tickets]);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <NewTicketForm onCreate={createTicket} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {COLUMNS.map((col) => (
            <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-secondary, #8b949e)',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                {t(`tickets.columns.${col}`)}
                <span style={{ opacity: 0.5, fontFamily: 'var(--font-mono, monospace)' }}>{grouped[col].length}</span>
              </div>
              {grouped[col].length === 0 ? (
                <div style={{ fontSize: 12, opacity: 0.4, padding: '8px 2px' }}>{t('tickets.empty')}</div>
              ) : (
                grouped[col].map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    onRetry={retryTicket}
                    onCancel={cancelTicket}
                    onDelete={deleteTicket}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

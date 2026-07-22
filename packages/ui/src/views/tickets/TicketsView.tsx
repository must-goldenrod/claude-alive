import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ticket } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../../App.tsx';
import { useTickets } from './useTickets.ts';
import { TicketCard } from './TicketCard.tsx';
import { NewTicketForm } from './NewTicketForm.tsx';
import { TicketDetailModal } from './TicketDetailModal.tsx';
import { statusGroup, type StatusGroup } from './ticketDisplay.ts';

interface TicketsViewProps {
  active: boolean;
  subscribeRaw: RawMessageSubscribe;
}

const COLUMNS: StatusGroup[] = ['active', 'done', 'failed'];

export function TicketsView({ active, subscribeRaw }: TicketsViewProps) {
  const { t } = useTranslation();
  const { tickets, evaluations, createTicket, retryTicket, cancelTicket, deleteTicket, evaluateTicket } = useTickets(active, subscribeRaw);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const g: Record<StatusGroup, Ticket[]> = { active: [], done: [], failed: [] };
    for (const ticket of tickets) g[statusGroup(ticket.state)].push(ticket);
    return g;
  }, [tickets]);

  // Derive the open ticket from the live list so it reflects state changes.
  const selected = selectedId ? tickets.find((x) => x.id === selectedId) ?? null : null;

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <NewTicketForm onCreate={createTicket} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {COLUMNS.map((col) => (
            <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary, #8b949e)', display: 'flex', gap: 8, alignItems: 'center' }}>
                {t(`tickets.columns.${col}`)}
                <span style={{ opacity: 0.5, fontFamily: 'var(--font-mono, monospace)' }}>{grouped[col].length}</span>
              </div>
              {grouped[col].length === 0 ? (
                <div style={{ fontSize: 12, opacity: 0.4, padding: '8px 2px' }}>{t('tickets.empty')}</div>
              ) : (
                grouped[col].map((ticket) => <TicketCard key={ticket.id} ticket={ticket} onOpen={(x) => setSelectedId(x.id)} />)
              )}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <TicketDetailModal
          ticket={selected}
          evaluation={evaluations[selected.id] ?? null}
          onClose={() => setSelectedId(null)}
          onRetry={retryTicket}
          onCancel={cancelTicket}
          onDelete={deleteTicket}
          onEvaluate={evaluateTicket}
        />
      )}
    </div>
  );
}

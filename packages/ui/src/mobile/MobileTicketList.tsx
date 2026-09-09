import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ticket, TicketEvaluation } from '@claude-alive/core';
import { displayStatus, STATUS_COLOR, projectName, ticketLastActivityAt } from '../views/tickets/ticketDisplay.ts';
import { COLORS, screen, topBar, body, card, primaryButton, actionBar } from './styles.ts';

export interface MobileTicketListProps {
  tickets: Ticket[];
  evaluations: Record<string, TicketEvaluation>;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Live socket state; a disconnected phone is showing stale rows. */
  connected?: boolean;
}

type Filter = 'all' | 'active' | 'decision' | 'done';

const MATCHES: Record<Filter, (t: Ticket) => boolean> = {
  all: () => true,
  active: (t) => t.state === 'queued' || t.state === 'running' || t.state === 'verifying',
  decision: (t) => t.state === 'decision',
  done: (t) => t.state === 'done' || t.state === 'failed',
};

/**
 * The phone's home screen: everything that is waiting on you, newest activity
 * first — except tickets parked on a question, which are pinned to the top.
 * Those are the only ones where nothing moves until you act, and on a phone you
 * are usually opening the app precisely because something is stuck.
 */
export function MobileTicketList({ tickets, evaluations, onOpen, onNew, connected = true }: MobileTicketListProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const visible = tickets.filter(MATCHES[filter]);
    return [...visible].sort((a, b) => {
      const blocked = (x: Ticket) => (x.state === 'decision' ? 0 : 1);
      if (blocked(a) !== blocked(b)) return blocked(a) - blocked(b);
      return ticketLastActivityAt(b) - ticketLastActivityAt(a);
    });
  }, [tickets, filter]);

  const counts: Record<Filter, number> = {
    all: tickets.length,
    active: tickets.filter(MATCHES.active).length,
    decision: tickets.filter(MATCHES.decision).length,
    done: tickets.filter(MATCHES.done).length,
  };

  const tabs: Array<{ id: Filter; text: string }> = [
    { id: 'all', text: t('mobile.filterAll') },
    { id: 'active', text: t('mobile.filterActive') },
    { id: 'decision', text: t('mobile.filterDecision') },
    { id: 'done', text: t('mobile.filterDone') },
  ];

  return (
    <div style={screen}>
      <div style={topBar}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{t('mobile.listTitle')}</span>
        {!connected && <span style={{ fontSize: 12, color: '#e5534b' }}>{t('mobile.offline')}</span>}
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 6, padding: '10px 12px 0', overflowX: 'auto', flexShrink: 0 }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={filter === tab.id}
            onClick={() => setFilter(tab.id)}
            style={{
              minHeight: 36, padding: '0 12px', borderRadius: 999, whiteSpace: 'nowrap', cursor: 'pointer',
              fontSize: 13, border: `1px solid ${filter === tab.id ? COLORS.accent : COLORS.border}`,
              background: filter === tab.id ? COLORS.accent : 'transparent',
              color: filter === tab.id ? '#0d1117' : COLORS.muted,
            }}
          >
            {tab.text} {counts[tab.id]}
          </button>
        ))}
      </div>

      <div style={body}>
        {rows.length === 0 ? (
          <p style={{ color: COLORS.muted, fontSize: 14, textAlign: 'center', marginTop: 48 }}>{t('mobile.empty')}</p>
        ) : (
          rows.map((ticket) => {
            const status = displayStatus(ticket.state, evaluations[ticket.id]);
            return (
              <button key={ticket.id} style={card} onClick={() => onOpen(ticket.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: STATUS_COLOR[status], flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: COLORS.muted }}>#{ticket.seq}</span>
                  <span style={{ fontSize: 12, color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {projectName(ticket.cwd)}
                  </span>
                </div>
                <div style={{ fontSize: 15, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {ticket.goal}
                </div>
                {ticket.headline && (
                  <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ticket.headline}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>

      <div style={actionBar}>
        <button style={primaryButton} onClick={onNew}>{t('mobile.newTicket')}</button>
      </div>
    </div>
  );
}

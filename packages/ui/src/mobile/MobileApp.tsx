import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketRunPreset, WSClientMessage } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../App.tsx';
import { useTickets } from '../views/tickets/useTickets.ts';
import { MobileTicketList } from './MobileTicketList.tsx';
import { MobileTicketCompose } from './MobileTicketCompose.tsx';
import type { MobileProject } from './types.ts';
import { MobileTicketDetail } from './MobileTicketDetail.tsx';
import { mergeProjects } from './mobileProjects.ts';
import { MobileSessions } from './MobileSessions.tsx';
import { parseCapabilities, type RemoteCapabilities } from './capabilities.ts';
import { COLORS } from './styles.ts';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

export interface MobileAppProps {
  subscribeRaw: RawMessageSubscribe;
  connected: boolean;
  send: (msg: WSClientMessage) => void;
}

/**
 * The whole phone experience: a list, a composer, and one ticket at a time.
 *
 * Deliberately not a shrunken dashboard. A phone is where you check what is
 * stuck, answer it, and start something — the terminals, the pixel office and
 * the analytics have no place on a 390px screen and, for a remote device, the
 * server refuses most of them anyway.
 */
export function MobileApp({ subscribeRaw, connected, send }: MobileAppProps) {
  const { t } = useTranslation();
  const { tickets, evaluations, createTicket, retryTicket, replyTicket, cancelTicket } = useTickets(true, subscribeRaw);
  const [screen, setScreen] = useState<'list' | 'compose'>('list');
  const [openId, setOpenId] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<MobileProject[]>([]);
  const [tab, setTab] = useState<'tickets' | 'sessions'>('tickets');
  const [caps, setCaps] = useState<RemoteCapabilities>({ terminal: 'off', remote: false });

  // Asked once: which controls this server will honour. A local-only server
  // answers 401/404 here and the sessions tab simply stays hidden.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/remote/capabilities`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setCaps(parseCapabilities(data)); })
      .catch(() => { /* older server, or offline */ });
    return () => { cancelled = true; };
  }, []);

  // The allowlist the server will actually accept. A local-only server answers
  // with an empty list (or 503), and the composer then falls back to history.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/remote/projects`)
      .then((res) => (res.ok ? res.json() : { projects: [] }))
      .then((data: { projects?: MobileProject[] }) => {
        if (!cancelled) setAllowed(data.projects ?? []);
      })
      .catch(() => {
        /* offline or not configured — history still gives the composer something */
      });
    return () => { cancelled = true; };
  }, []);

  const projects = useMemo(() => mergeProjects(allowed, tickets), [allowed, tickets]);
  const open = openId ? tickets.find((t) => t.id === openId) ?? null : null;

  // A ticket deleted elsewhere must not leave the phone on a dead screen.
  useEffect(() => {
    if (openId && !tickets.some((t) => t.id === openId)) setOpenId(null);
  }, [openId, tickets]);

  if (open) {
    return (
      <MobileTicketDetail
        ticket={open}
        onBack={() => setOpenId(null)}
        onReply={(prompt) => replyTicket(open.id, prompt)}
        onCancel={() => { void cancelTicket(open.id); }}
        onRetry={() => { void retryTicket(open.id); }}
      />
    );
  }

  if (screen === 'compose') {
    return (
      <MobileTicketCompose
        projects={projects}
        onCancel={() => setScreen('list')}
        onCreate={(goal: string, cwd: string, preset: TicketRunPreset) =>
          createTicket(goal, cwd, undefined, undefined, preset)
        }
      />
    );
  }

  const sessionsAvailable = caps.terminal !== 'off';

  const body =
    tab === 'sessions' && sessionsAvailable ? (
      <MobileSessions subscribeRaw={subscribeRaw} send={send} terminalLevel={caps.terminal} projects={projects} />
    ) : (
      <MobileTicketList
        tickets={tickets}
        evaluations={evaluations}
        connected={connected}
        onOpen={setOpenId}
        onNew={() => setScreen('compose')}
      />
    );

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: COLORS.bg }}>
      {/* The switcher only appears when there is somewhere else to go: on a
          server that never opened the session surface, a dead tab confuses. */}
      {sessionsAvailable && (
        <div role="tablist" style={{ display: 'flex', flexShrink: 0, borderBottom: `1px solid ${COLORS.border}` }}>
          {(['tickets', 'sessions'] as const).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              style={{
                flex: 1, minHeight: 44, border: 'none', cursor: 'pointer', fontSize: 14,
                background: 'transparent',
                color: tab === id ? COLORS.accent : COLORS.muted,
                borderBottom: `2px solid ${tab === id ? COLORS.accent : 'transparent'}`,
              }}
            >
              {t(id === 'tickets' ? 'mobile.tabTickets' : 'mobile.tabSessions')}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{body}</div>
    </div>
  );
}

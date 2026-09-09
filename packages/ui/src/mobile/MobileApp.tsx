import { useEffect, useMemo, useState } from 'react';
import type { TicketRunPreset } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../App.tsx';
import { useTickets } from '../views/tickets/useTickets.ts';
import { MobileTicketList } from './MobileTicketList.tsx';
import { MobileTicketCompose } from './MobileTicketCompose.tsx';
import type { MobileProject } from './types.ts';
import { MobileTicketDetail } from './MobileTicketDetail.tsx';
import { mergeProjects } from './mobileProjects.ts';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

export interface MobileAppProps {
  subscribeRaw: RawMessageSubscribe;
  connected: boolean;
}

/**
 * The whole phone experience: a list, a composer, and one ticket at a time.
 *
 * Deliberately not a shrunken dashboard. A phone is where you check what is
 * stuck, answer it, and start something — the terminals, the pixel office and
 * the analytics have no place on a 390px screen and, for a remote device, the
 * server refuses most of them anyway.
 */
export function MobileApp({ subscribeRaw, connected }: MobileAppProps) {
  const { tickets, evaluations, createTicket, retryTicket, replyTicket, cancelTicket } = useTickets(true, subscribeRaw);
  const [screen, setScreen] = useState<'list' | 'compose'>('list');
  const [openId, setOpenId] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<MobileProject[]>([]);

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

  return (
    <MobileTicketList
      tickets={tickets}
      evaluations={evaluations}
      connected={connected}
      onOpen={setOpenId}
      onNew={() => setScreen('compose')}
    />
  );
}

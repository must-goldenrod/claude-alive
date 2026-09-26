import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { projectName } from '../views/tickets/ticketDisplay.ts';
import { COLORS, screen, body, card, chip, TYPE, clamp1, clamp2 } from './styles.ts';
import { PullToRefresh } from './PullToRefresh.tsx';
import { formatStamp } from './time.ts';
import { oneOf, usePersistedState } from './viewState.ts';

export interface MobileSession {
  sessionId: string;
  displayName: string;
  state: string;
  cwd: string;
  lastActivityAt: number;
  /** The session is blocked on a human approving a tool call. */
  needsApproval: boolean;
  /** Provider session id — the key the terminal index matches on. */
  providerSessionId?: string;
  /** The server-owned pty backing this row, when there is one. */
  tabId?: string;
  /** Which kind of client started that pty. Only 'mobile' may be resized here. */
  origin?: 'desktop' | 'mobile';
  /** The pty is still running. Undefined when no pty is known. */
  terminalLive?: boolean;
}

export type SessionFilter = 'all' | 'active' | 'waiting' | 'done';
const isSessionFilter = oneOf<SessionFilter>('all', 'active', 'waiting', 'done');

export interface MobileSessionListProps {
  sessions: MobileSession[];
  loading: boolean;
  onOpen: (sessionId: string) => void;
  /** Refetch, for the pull gesture. */
  onRefresh?: () => void | Promise<void>;
}

/** States that mean the session is doing something right now. */
const BUSY = new Set(['running', 'using-tool', 'active', 'starting', 'thinking']);
/** States that mean it is waiting on a person. */
const WAITING = new Set(['waiting', 'waiting-user', 'awaiting-approval']);

export function sessionGroup(session: MobileSession): Exclude<SessionFilter, 'all'> {
  if (session.needsApproval || WAITING.has(session.state)) return 'waiting';
  // A row whose pty is known to be gone is finished, whatever state the
  // catalog last recorded — a month-old session still reads as `starting`.
  if (session.terminalLive === false) return 'done';
  if (BUSY.has(session.state)) return 'active';
  return 'done';
}

/**
 * How many rows the phone shows. Applied after sorting, not before: slicing the
 * catalog first handed the sort an arbitrary 60 of 610 and put July at the top.
 */
const MAX_ROWS = 60;

const GROUP_COLOR: Record<Exclude<SessionFilter, 'all'>, string> = {
  active: 'var(--accent-green)',
  waiting: 'var(--accent-amber)',
  done: COLORS.muted,
};

/**
 * Every Claude session and every server-owned terminal, newest activity first.
 *
 * The catalog keeps every session this machine has ever run — 610 of them here,
 * of which 2 were active in the last hour. A month-old session whose state was
 * never updated still reads as `starting`, so recency alone decides the order;
 * a session waiting on approval is marked and filterable, not lifted.
 *
 * The heading of a row is the checkout, not the session title: on a phone the
 * first question is always "which project is this", and the title — often the
 * first line of a prompt — answers a later one. The state sits beside it as a
 * badge, and the filters above narrow to it, because "what is waiting on me"
 * is why the list was opened.
 */
export function MobileSessionList({ sessions, loading, onOpen, onRefresh }: MobileSessionListProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = usePersistedState<SessionFilter>('sessionFilter', 'all', isSessionFilter);

  const counts = useMemo(() => {
    const out: Record<SessionFilter, number> = { all: sessions.length, active: 0, waiting: 0, done: 0 };
    for (const session of sessions) out[sessionGroup(session)] += 1;
    return out;
  }, [sessions]);

  const rows = useMemo(() => {
    const visible = filter === 'all' ? sessions : sessions.filter((s) => sessionGroup(s) === filter);
    return [...visible].sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, MAX_ROWS);
  }, [sessions, filter]);

  const tabs: Array<{ id: SessionFilter; text: string }> = [
    { id: 'all', text: t('mobile.filterAll') },
    { id: 'active', text: t('mobile.sessionFilterActive') },
    { id: 'waiting', text: t('mobile.sessionFilterWaiting') },
    { id: 'done', text: t('mobile.sessionFilterDone') },
  ];

  return (
    // `screen` is already `absolute; inset: 0`. Overriding it with `relative`
    // let this box grow to its content, so the pane below had nothing to scroll.
    <div style={screen}>
      <div role="tablist" style={{ display: 'flex', gap: 6, padding: '10px 12px 0', overflowX: 'auto', flexShrink: 0 }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={filter === tab.id}
            onClick={() => setFilter(tab.id)}
            style={{
              ...chip,
              border: `1px solid ${filter === tab.id ? COLORS.accent : COLORS.border}`,
              background: filter === tab.id ? COLORS.accent : 'transparent',
              color: filter === tab.id ? 'var(--on-accent)' : COLORS.muted,
            }}
          >
            {tab.text} {counts[tab.id]}
          </button>
        ))}
      </div>

      <PullToRefresh onRefresh={onRefresh} style={{ ...body, paddingTop: 12, paddingBottom: 88 }}>
        {loading && rows.length === 0 ? (
          <p style={{ ...TYPE.body, color: COLORS.muted, textAlign: 'center', marginTop: 48 }}>{t('mobile.sessionsLoading')}</p>
        ) : rows.length === 0 ? (
          <p style={{ ...TYPE.body, color: COLORS.muted, textAlign: 'center', marginTop: 48 }}>{t('mobile.sessionsEmpty')}</p>
        ) : (
          rows.map((s) => {
            const group = sessionGroup(s);
            return (
              <button key={s.sessionId} style={card} onClick={() => onOpen(s.sessionId)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ ...TYPE.title, ...clamp1, flex: 1 }}>
                    {projectName(s.cwd) || t('mobile.sessionNoProject')}
                  </span>
                  <span
                    style={{
                      ...TYPE.badge, flexShrink: 0, padding: '2px 8px', borderRadius: 6,
                      border: `1px solid ${GROUP_COLOR[group]}`, color: GROUP_COLOR[group],
                    }}
                  >
                    {t(`mobile.sessionFilter${group[0]!.toUpperCase()}${group.slice(1)}`)}
                  </span>
                  {s.needsApproval && (
                    <span
                      aria-label={t('mobile.needsApproval')}
                      title={t('mobile.needsApproval')}
                      style={{ ...TYPE.badge, color: 'var(--accent-amber)', flexShrink: 0 }}
                    >
                      ●
                    </span>
                  )}
                </div>
                <div style={{ ...TYPE.body, ...clamp2, color: COLORS.muted }}>
                  {s.displayName || s.sessionId.slice(0, 12)}
                </div>
                <div style={{ ...TYPE.meta, color: COLORS.muted, marginTop: 6 }}>
                  {formatStamp(s.lastActivityAt) || t('mobile.sessionNoActivity')}
                </div>
              </button>
            );
          })
        )}
      </PullToRefresh>
    </div>
  );
}

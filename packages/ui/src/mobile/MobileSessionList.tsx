import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { projectName } from '../views/tickets/ticketDisplay.ts';
import { COLORS, screen, body, card, TYPE, clamp1, clamp2 } from './styles.ts';

export interface MobileSession {
  sessionId: string;
  displayName: string;
  state: string;
  cwd: string;
  lastActivityAt: number;
  /** The session is blocked on a human approving a tool call. */
  needsApproval: boolean;
}

export interface MobileSessionListProps {
  sessions: MobileSession[];
  loading: boolean;
  onOpen: (sessionId: string) => void;
}

/** States that mean the session is doing something right now. */
const BUSY = new Set(['running', 'using-tool', 'active', 'starting', 'thinking']);
/** States that mean it is waiting on a person. */
const WAITING = new Set(['waiting', 'waiting-user', 'awaiting-approval']);

/**
 * How far back from the newest session still counts as "now".
 *
 * The catalog keeps every session this machine has ever run — 610 of them here,
 * of which 2 were active in the last hour. A month-old session whose state was
 * never updated still reads as `starting`, so ordering by state alone put
 * ghosts at the top. Recency decides, and only a recently blocked session is
 * lifted above it.
 */
const RECENT_MS = 60 * 60 * 1000;

/**
 * How many rows the phone shows. Applied after sorting, not before: slicing the
 * catalog first handed the sort an arbitrary 60 of 610 and put July at the top.
 */
const MAX_ROWS = 60;

function stateColor(state: string): string {
  if (BUSY.has(state)) return '#3fb950';
  if (WAITING.has(state)) return '#d29922';
  return COLORS.muted;
}

/**
 * Every Claude Code session this machine knows about, busiest first.
 *
 * A session that is mid-tool is the one you opened the phone to look at; a
 * stopped one from last week is not, however recently it was touched.
 */
export function MobileSessionList({ sessions, loading, onOpen }: MobileSessionListProps) {
  const { t } = useTranslation();

  const rows = useMemo(() => {
    const newest = sessions.reduce((max, s) => Math.max(max, s.lastActivityAt), 0);
    const blocked = (s: MobileSession) =>
      (s.needsApproval || WAITING.has(s.state)) && newest - s.lastActivityAt < RECENT_MS ? 0 : 1;
    return [...sessions]
      .sort((a, b) => blocked(a) - blocked(b) || b.lastActivityAt - a.lastActivityAt)
      .slice(0, MAX_ROWS);
  }, [sessions]);

  return (
    <div style={{ ...screen, position: 'relative' }}>
      {/* No title bar — the tab above names this list. */}
      <div style={{ ...body, paddingTop: 12, paddingBottom: 24 }}>
        {loading && rows.length === 0 ? (
          <p style={{ ...TYPE.body, color: COLORS.muted, textAlign: 'center', marginTop: 48 }}>{t('mobile.sessionsLoading')}</p>
        ) : rows.length === 0 ? (
          <p style={{ ...TYPE.body, color: COLORS.muted, textAlign: 'center', marginTop: 48 }}>{t('mobile.sessionsEmpty')}</p>
        ) : (
          rows.map((s) => (
            <button key={s.sessionId} style={card} onClick={() => onOpen(s.sessionId)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: stateColor(s.state), flexShrink: 0 }} />
                <span style={{ ...TYPE.meta, color: COLORS.muted }}>{s.state}</span>
                <span style={{ ...TYPE.meta, ...clamp1, color: COLORS.muted }}>{projectName(s.cwd)}</span>
                {s.needsApproval && (
                  <span
                    aria-label={t('mobile.needsApproval')}
                    title={t('mobile.needsApproval')}
                    style={{ ...TYPE.badge, marginLeft: 'auto', color: '#d29922' }}
                  >
                    ●
                  </span>
                )}
              </div>
              <div style={{ ...TYPE.body, ...clamp2 }}>{s.displayName || s.sessionId.slice(0, 12)}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

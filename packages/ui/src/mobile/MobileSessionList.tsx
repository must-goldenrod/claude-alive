import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { projectName } from '../views/tickets/ticketDisplay.ts';
import { COLORS, screen, topBar, body, card } from './styles.ts';

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
const WAITING = new Set(['ready', 'waiting', 'awaiting-approval']);

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
    const weight = (s: MobileSession) => (BUSY.has(s.state) ? 0 : WAITING.has(s.state) ? 1 : 2);
    return [...sessions].sort((a, b) => weight(a) - weight(b) || b.lastActivityAt - a.lastActivityAt);
  }, [sessions]);

  return (
    <div style={{ ...screen, position: 'relative' }}>
      <div style={topBar}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{t('mobile.tabSessions')}</span>
      </div>
      <div style={{ ...body, paddingBottom: 24 }}>
        {loading && rows.length === 0 ? (
          <p style={{ color: COLORS.muted, fontSize: 14, textAlign: 'center', marginTop: 48 }}>{t('mobile.sessionsLoading')}</p>
        ) : rows.length === 0 ? (
          <p style={{ color: COLORS.muted, fontSize: 14, textAlign: 'center', marginTop: 48 }}>{t('mobile.sessionsEmpty')}</p>
        ) : (
          rows.map((s) => (
            <button key={s.sessionId} style={card} onClick={() => onOpen(s.sessionId)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: stateColor(s.state), flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: COLORS.muted }}>{s.state}</span>
                <span style={{ fontSize: 12, color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {projectName(s.cwd)}
                </span>
                {s.needsApproval && (
                  <span
                    aria-label={t('mobile.needsApproval')}
                    title={t('mobile.needsApproval')}
                    style={{ marginLeft: 'auto', fontSize: 11, color: '#d29922' }}
                  >
                    ●
                  </span>
                )}
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {s.displayName || s.sessionId.slice(0, 12)}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

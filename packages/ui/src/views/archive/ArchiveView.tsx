import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompletedSession } from '@claude-alive/core';
import {
  ARCHIVE_STATE_COLOR,
  ArchiveSessionDetail,
  formatArchiveDuration,
} from './ArchiveSessionDetail.tsx';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

interface ArchiveViewProps {
  active: boolean;
  /** When set (e.g. from Ticket Management's "view the process" link), select the
   * matching completed session by its id, best-effort. Ignored if not in the archive. */
  focusSessionId?: string | null;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function fmtClock(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function ArchiveView({ active, focusSessionId }: ArchiveViewProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CompletedSession[] | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/completed?limit=1000`);
      if (!res.ok) {
        setReachable(false);
        return;
      }
      const data = (await res.json()) as { sessions: CompletedSession[] };
      setRows(data.sessions ?? []);
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [active, refresh]);

  // Filter by project/name/prompt text.
  const filtered = useMemo(() => {
    const all = rows ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) =>
      (r.projectName ?? '').toLowerCase().includes(q) ||
      (r.displayName ?? '').toLowerCase().includes(q) ||
      (r.lastPrompt ?? '').toLowerCase().includes(q) ||
      (r.cwd ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Group into time buckets (rows arrive newest-first from the server).
  const groups = useMemo(() => {
    const now = Date.now();
    const today = startOfDay(now);
    const yesterday = today - 86_400_000;
    const weekAgo = today - 6 * 86_400_000;
    const buckets: { key: string; label: string; items: { row: CompletedSession; idx: number }[] }[] = [
      { key: 'today', label: t('archive.bucket.today'), items: [] },
      { key: 'yesterday', label: t('archive.bucket.yesterday'), items: [] },
      { key: 'week', label: t('archive.bucket.week'), items: [] },
      { key: 'earlier', label: t('archive.bucket.earlier'), items: [] },
    ];
    filtered.forEach((row, idx) => {
      const c = row.completedAt;
      if (c >= today) buckets[0]!.items.push({ row, idx });
      else if (c >= yesterday) buckets[1]!.items.push({ row, idx });
      else if (c >= weekAgo) buckets[2]!.items.push({ row, idx });
      else buckets[3]!.items.push({ row, idx });
    });
    return buckets.filter((b) => b.items.length > 0);
  }, [filtered, t]);

  // Deep-link from Ticket Management: when a target session id arrives and it is
  // present in the archive, select it. Best-effort — an id that never terminated
  // (or predates the archive) simply leaves the current selection untouched.
  useEffect(() => {
    if (!active || !focusSessionId) return;
    const idx = filtered.findIndex((r) => r.sessionId === focusSessionId);
    if (idx >= 0) setSelectedIdx(idx);
  }, [active, focusSessionId, filtered]);

  const selected = selectedIdx != null ? filtered[selectedIdx] ?? null : null;

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    height: '100%',
    width: '100%',
    overflow: 'hidden',
  };

  if (reachable === false) {
    return (
      <div style={{ ...containerStyle, alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', flexDirection: 'column', gap: 8, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{t('archive.unreachable.title')}</div>
        <div style={{ fontSize: 13, maxWidth: 460, lineHeight: 1.5 }}>{t('archive.unreachable.body')}</div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* List pane */}
      <div
        style={{
          width: 440,
          minWidth: 300,
          maxWidth: '50%',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-secondary)',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t('archive.listTitle')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6 }}>{filtered.length}</div>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('archive.searchPlaceholder')}
            aria-label={t('archive.searchPlaceholder')}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              outline: 'none',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              {rows === null ? t('archive.loading') : t('archive.empty')}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key}>
                <div
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                    padding: '6px 16px',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  {g.label} · {g.items.length}
                </div>
                {g.items.map(({ row, idx }) => {
                  const isSel = idx === selectedIdx;
                  const color = ARCHIVE_STATE_COLOR[row.finalState ?? 'done'] ?? 'var(--text-secondary)';
                  return (
                    <button
                      key={`${row.sessionId}-${row.completedAt}`}
                      onClick={() => setSelectedIdx(idx)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        padding: '10px 16px',
                        borderBottom: '1px solid var(--border-color)',
                        background: isSel ? 'rgba(88, 166, 255, 0.10)' : 'transparent',
                        border: 'none',
                        borderLeft: isSel ? '2px solid var(--accent-blue)' : '2px solid transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.projectName || t('agents.generalAgent')}
                        </span>
                        {row.parentId && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '0 4px', borderRadius: 4, color: 'var(--accent-purple)', border: '1px solid var(--accent-purple)' }}>
                            SUB
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-secondary)', opacity: 0.7, fontFamily: 'var(--font-mono)' }}>
                          {fmtClock(row.completedAt)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16 }}>
                        <span style={{ fontSize: 10, color, fontWeight: 600 }}>{t(`states.${row.finalState ?? 'done'}`, { defaultValue: row.finalState ?? '' })}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.5 }}>·</span>
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{formatArchiveDuration(row.durationMs)}</span>
                        {row.tokenUsage && (
                          <>
                            <span style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.5 }}>·</span>
                            <span style={{ fontSize: 10, color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>
                              {row.tokenUsage.totalTokens.toLocaleString()} {t('archive.tokensShort')}
                            </span>
                          </>
                        )}
                      </div>
                      {row.lastPrompt && (
                        <div style={{ paddingLeft: 16, fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.lastPrompt}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24, minWidth: 0 }}>
        {!selected ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('archive.detail.empty')}</div>
        ) : (
          <ArchiveSessionDetail session={selected} />
        )}
      </div>
    </div>
  );
}

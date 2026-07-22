import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketEvaluation } from '@claude-alive/core';
import { fetchRecords, setLabel, setReflected, type EvalLabel } from './api.ts';
import { TicketDissection } from './TicketDissection.tsx';

interface TicketMgmtViewProps {
  active: boolean;
}

const LABEL_COLOR: Record<EvalLabel, string> = {
  good: 'var(--accent-teal)',
  bad: 'var(--accent-red)',
  unrated: 'var(--text-secondary)',
};

interface RouteGroup {
  route: string;
  title: string;
  records: TicketEvaluation[];
  total: number;
  good: number;
  bad: number;
  reflected: number;
  recentAt: number;
}

function basename(route: string): string {
  const parts = route.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? route;
}

/**
 * Ticket management (spec 2026-07-22): a route-grouped, score-and-decide surface
 * over the durable ticket-evaluation dataset. Left pane groups tickets by project
 * (route); right pane dissects one ticket and gates whether it shapes the bias.
 */
export function TicketMgmtView({ active }: TicketMgmtViewProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<TicketEvaluation[] | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [guideRefreshKey, setGuideRefreshKey] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const recs = await fetchRecords();
      setRecords(recs);
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

  const groups = useMemo<RouteGroup[]>(() => {
    const all = records ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter((r) =>
          (r.goal ?? '').toLowerCase().includes(q) ||
          (r.headline ?? '').toLowerCase().includes(q) ||
          (r.route ?? '').toLowerCase().includes(q),
        )
      : all;

    const byRoute = new Map<string, TicketEvaluation[]>();
    for (const r of filtered) {
      const list = byRoute.get(r.route) ?? [];
      list.push(r);
      byRoute.set(r.route, list);
    }

    return [...byRoute.entries()]
      .map(([route, recs]) => {
        const sorted = [...recs].sort((a, b) => b.updatedAt - a.updatedAt || b.seq - a.seq);
        return {
          route,
          title: basename(route),
          records: sorted,
          total: sorted.length,
          good: sorted.filter((r) => r.label === 'good').length,
          bad: sorted.filter((r) => r.label === 'bad').length,
          reflected: sorted.filter((r) => r.reflected).length,
          recentAt: sorted[0]?.updatedAt ?? 0,
        };
      })
      .sort((a, b) => b.recentAt - a.recentAt);
  }, [records, query]);

  const selected = useMemo(
    () => (selectedId ? (records ?? []).find((r) => r.ticketId === selectedId) ?? null : null),
    [records, selectedId],
  );

  const applyRecord = useCallback((rec: TicketEvaluation) => {
    setRecords((prev) => (prev ? prev.map((r) => (r.ticketId === rec.ticketId ? rec : r)) : prev));
  }, []);

  const handleLabel = useCallback(
    async (ticketId: string, input: { label: EvalLabel; weight: number; note: string }) => {
      try {
        const rec = await setLabel(ticketId, input);
        applyRecord(rec);
      } catch {
        // Server rejected — pull fresh truth so the UI never shows a phantom change.
        refresh();
      }
    },
    [applyRecord, refresh],
  );

  const handleReflect = useCallback(
    async (ticketId: string, reflected: boolean) => {
      try {
        const rec = await setReflected(ticketId, reflected);
        applyRecord(rec);
        setGuideRefreshKey((k) => k + 1); // the bias changed → refetch the preview
      } catch {
        refresh();
      }
    },
    [applyRecord, refresh],
  );

  const toggleCollapsed = (route: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(route)) next.delete(route);
      else next.add(route);
      return next;
    });
  };

  const containerStyle: React.CSSProperties = { display: 'flex', height: '100%', width: '100%', overflow: 'hidden' };

  if (reachable === false) {
    return (
      <div style={{ ...containerStyle, alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', flexDirection: 'column', gap: 8, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{t('ticketMgmt.unreachable.title')}</div>
        <div style={{ fontSize: 13, maxWidth: 460, lineHeight: 1.5 }}>{t('ticketMgmt.unreachable.body')}</div>
      </div>
    );
  }

  const totalRecords = (records ?? []).length;

  return (
    <div style={containerStyle}>
      {/* List pane */}
      <div style={{ width: 440, minWidth: 300, maxWidth: '50%', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t('ticketMgmt.listTitle')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6 }}>{totalRecords}</div>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('ticketMgmt.searchPlaceholder')}
            aria-label={t('ticketMgmt.searchPlaceholder')}
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 8, outline: 'none' }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {groups.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              {records === null ? t('ticketMgmt.loading') : t('ticketMgmt.empty')}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.route}>
                <button
                  onClick={() => toggleCollapsed(g.route)}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 16px', background: 'var(--bg-secondary)', border: 'none', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', position: 'sticky', top: 0, zIndex: 1 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 10 }}>{collapsed.has(g.route) ? '▸' : '▾'}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.title}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{g.total} {t('ticketMgmt.stat.total')}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 18, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: 'var(--accent-teal)' }}>{g.good} {t('ticketMgmt.stat.good')}</span>
                    <span style={{ color: 'var(--accent-red)' }}>{g.bad} {t('ticketMgmt.stat.bad')}</span>
                    <span style={{ color: 'var(--accent-blue)' }}>{g.reflected} {t('ticketMgmt.stat.reflected')}</span>
                  </div>
                </button>
                {!collapsed.has(g.route) && g.records.map((r) => {
                  const isSel = r.ticketId === selectedId;
                  return (
                    <button
                      key={r.ticketId}
                      onClick={() => setSelectedId(r.ticketId)}
                      style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 16px 10px 24px', borderBottom: '1px solid var(--border-color)', background: isSel ? 'rgba(88, 166, 255, 0.10)' : 'transparent', border: 'none', borderLeft: isSel ? '2px solid var(--accent-blue)' : '2px solid transparent', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: LABEL_COLOR[r.label], flexShrink: 0 }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>#{r.seq}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.headline || r.goal}</span>
                        {r.reflected && (
                          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, padding: '0 5px', borderRadius: 4, color: 'var(--accent-teal)', border: '1px solid var(--accent-teal)' }}>
                            {t('ticketMgmt.reflected')}
                          </span>
                        )}
                      </div>
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
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('ticketMgmt.detail.empty')}</div>
        ) : (
          <TicketDissection
            record={selected}
            guideRefreshKey={guideRefreshKey}
            onLabel={(input) => handleLabel(selected.ticketId, input)}
            onReflect={(reflected) => handleReflect(selected.ticketId, reflected)}
          />
        )}
      </div>
    </div>
  );
}

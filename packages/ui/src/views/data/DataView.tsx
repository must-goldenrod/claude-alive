import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageRecordDTO } from '@claude-alive/core';
import { formatTokens, formatCost } from '../tickets/ticketDisplay.ts';
import {
  summarizeRecords,
  type PeriodGranularity,
  type PeriodBucket,
  type UsageTotals,
  type UsageSummary,
} from './usageAggregation.ts';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

/** Max buckets rendered per granularity so the chart never overflows horizontally. */
const MAX_BARS: Record<PeriodGranularity, number> = { day: 30, week: 26, month: 12 };

interface DataViewProps {
  active: boolean;
}

/** Compact "1,234" grouping for exact counts in tiles/tables. */
function grouped(n: number): string {
  return Math.round(n).toLocaleString();
}

export function DataView({ active }: DataViewProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<UsageRecordDTO[] | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [granularity, setGranularity] = useState<PeriodGranularity>('day');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/usage`);
      if (!res.ok) {
        setReachable(false);
        return;
      }
      const data = (await res.json()) as { records?: UsageRecordDTO[] };
      setRecords(data.records ?? []);
      setReachable(true);
    } catch {
      setReachable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
  }, [active, refresh]);

  const summary = useMemo(() => summarizeRecords(records ?? []), [records]);

  const buckets = useMemo(() => {
    const all =
      granularity === 'day' ? summary.byDay : granularity === 'week' ? summary.byWeek : summary.byMonth;
    return all.slice(-MAX_BARS[granularity]);
  }, [summary, granularity]);

  if (reachable === false) {
    return (
      <div style={centeredMessage}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{t('data.unreachable.title')}</div>
        <div style={{ fontSize: 13, maxWidth: 460, lineHeight: 1.5 }}>{t('data.unreachable.body')}</div>
      </div>
    );
  }

  const isEmpty = reachable === true && summary.recordCount === 0;

  return (
    <div style={{ height: '100%', width: '100%', overflowY: 'auto', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 24px 48px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{t('data.title')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
              {t('data.subtitle')}
            </div>
          </div>
          <button onClick={refresh} disabled={loading} style={refreshBtn}>
            {loading ? t('data.refreshing') : t('data.refresh')}
          </button>
        </div>

        {isEmpty ? (
          <div style={{ ...centeredMessage, height: 240 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{t('data.empty.title')}</div>
            <div style={{ fontSize: 13, maxWidth: 460, lineHeight: 1.5 }}>{t('data.empty.body')}</div>
          </div>
        ) : (
          <>
            {/* Grand-total stat tiles */}
            <div style={tileRow}>
              <StatTile label={t('data.stat.totalTokens')} value={formatTokens(summary.total.totalTokens) ?? '0'} sub={`${grouped(summary.total.totalTokens)} tok`} accent="var(--accent-blue)" />
              <StatTile label={t('data.stat.totalCost')} value={formatCost(summary.total.costUsd) ?? '$0'} sub={t('data.stat.ccusageBased')} accent="var(--accent-teal)" />
              <StatTile label={t('data.stat.totalCalls')} value={grouped(summary.total.calls)} sub={t('data.stat.records', { count: summary.recordCount })} accent="var(--accent-amber)" />
              <StatTile label={t('data.stat.models')} value={grouped(summary.modelCount)} sub={t('data.stat.distinct')} accent="var(--accent-purple)" />
            </div>

            {/* Rolling period totals */}
            <div style={{ ...tileRow, marginTop: 10 }}>
              <PeriodTile label={t('data.stat.today')} totals={summary.today} />
              <PeriodTile label={t('data.stat.thisWeek')} totals={summary.thisWeek} />
              <PeriodTile label={t('data.stat.thisMonth')} totals={summary.thisMonth} />
            </div>

            {/* Time-series bar chart */}
            <section style={card}>
              <div style={cardHeader}>
                <div style={cardTitle}>{t('data.chart.tokensByPeriod')}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['day', 'week', 'month'] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGranularity(g)}
                      style={g === granularity ? toggleActive : toggleBtn}
                    >
                      {t(`data.period.${g}`)}
                    </button>
                  ))}
                </div>
              </div>
              <BarChart buckets={buckets} emptyLabel={t('data.chart.empty')} costLabel={t('data.table.cost')} callsLabel={t('data.table.calls')} tokensLabel={t('data.table.total')} />
            </section>

            {/* Per-model breakdown table */}
            <section style={card}>
              <div style={cardHeader}>
                <div style={cardTitle}>{t('data.table.title')}</div>
              </div>
              <ModelTable summary={summary} t={t} />
            </section>

            <div style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6, marginTop: 14, lineHeight: 1.5 }}>
              {t('data.footnote')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- subcomponents ---------- */

function StatTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div style={{ ...tile, borderTop: `2px solid ${accent}` }}>
      <div style={tileLabel}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function PeriodTile({ label, totals }: { label: string; totals: UsageTotals }) {
  return (
    <div style={tile}>
      <div style={tileLabel}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', lineHeight: 1.15 }}>
        {formatTokens(totals.totalTokens) ?? '0'} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>tok</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>
        {formatCost(totals.costUsd) ?? '$0'} · {grouped(totals.calls)} calls
      </div>
    </div>
  );
}

function BarChart({
  buckets,
  emptyLabel,
  tokensLabel,
  costLabel,
  callsLabel,
}: {
  buckets: PeriodBucket[];
  emptyLabel: string;
  tokensLabel: string;
  costLabel: string;
  callsLabel: string;
}) {
  if (buckets.length === 0) {
    return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>{emptyLabel}</div>;
  }
  const max = Math.max(...buckets.map((b) => b.totalTokens), 1);
  const CHART_H = 168;
  // Show every Nth label when bars are dense to avoid overlap.
  const labelStride = Math.ceil(buckets.length / 12);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: CHART_H + 22, paddingTop: 8 }}>
      {buckets.map((b, i) => {
        const h = Math.max(2, Math.round((b.totalTokens / max) * CHART_H));
        const title = `${b.label}\n${tokensLabel}: ${grouped(b.totalTokens)}\n${costLabel}: ${formatCost(b.costUsd) ?? '$0'}\n${callsLabel}: ${grouped(b.calls)}`;
        return (
          <div key={b.start} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            <div
              title={title}
              style={{
                width: '100%',
                maxWidth: 34,
                height: h,
                background: 'var(--accent-blue)',
                borderRadius: '4px 4px 0 0',
                transition: 'height 0.2s',
              }}
            />
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'nowrap', height: 12, overflow: 'hidden' }}>
              {i % labelStride === 0 ? b.label : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModelTable({ summary, t }: { summary: UsageSummary; t: (k: string) => string }) {
  const grand = summary.total.totalTokens || 1;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thLeft}>{t('data.table.model')}</th>
            <th style={thRight}>{t('data.table.input')}</th>
            <th style={thRight}>{t('data.table.output')}</th>
            <th style={thRight}>{t('data.table.cache')}</th>
            <th style={thRight}>{t('data.table.total')}</th>
            <th style={thRight}>{t('data.table.cost')}</th>
            <th style={thRight}>{t('data.table.calls')}</th>
            <th style={{ ...thLeft, width: 120 }}>{t('data.table.share')}</th>
          </tr>
        </thead>
        <tbody>
          {summary.byModel.map((m) => {
            const share = m.totalTokens / grand;
            return (
              <tr key={m.model} style={{ borderTop: '1px solid var(--border-color)' }}>
                <td style={{ ...tdLeft, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{m.model}</td>
                <td style={tdRight}>{grouped(m.inputTokens)}</td>
                <td style={tdRight}>{grouped(m.outputTokens)}</td>
                <td style={tdRight}>{grouped(m.cacheTokens)}</td>
                <td style={{ ...tdRight, color: 'var(--text-primary)', fontWeight: 600 }}>{grouped(m.totalTokens)}</td>
                <td style={tdRight}>{formatCost(m.costUsd) ?? '—'}</td>
                <td style={tdRight}>{grouped(m.calls)}</td>
                <td style={tdLeft}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 6, background: 'var(--bg-primary)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round(share * 100)}%`, height: '100%', background: 'var(--accent-blue)', borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', minWidth: 30, textAlign: 'right' }}>{(share * 100).toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- styles ---------- */

const centeredMessage: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 8, padding: 40, textAlign: 'center', color: 'var(--text-secondary)', height: '100%', width: '100%',
};
const tileRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 };
const tile: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '14px 16px' };
const tileLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 };
const card: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '16px 18px', marginTop: 16 };
const cardHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 };
const cardTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' };
const refreshBtn: React.CSSProperties = { padding: '6px 14px', fontSize: 12, fontWeight: 600, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' };
const toggleBtn: React.CSSProperties = { padding: '4px 12px', fontSize: 11.5, fontWeight: 600, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 7, cursor: 'pointer' };
const toggleActive: React.CSSProperties = { ...toggleBtn, background: 'var(--accent-blue)', color: '#fff', borderColor: 'var(--accent-blue)' };
const thBase: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '6px 8px' };
const thLeft: React.CSSProperties = { ...thBase, textAlign: 'left' };
const thRight: React.CSSProperties = { ...thBase, textAlign: 'right' };
const tdBase: React.CSSProperties = { padding: '7px 8px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' };
const tdLeft: React.CSSProperties = { ...tdBase, textAlign: 'left' };
const tdRight: React.CSSProperties = { ...tdBase, textAlign: 'right' };

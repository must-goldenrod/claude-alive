import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { EfficioAxisKey, EfficioAxisStatus, EfficioStatus, EfficioTimelineRow } from '@claude-alive/core';

// Local mirror of core's AXES. We deliberately avoid importing the value
// from @claude-alive/core: that package's runtime entry pulls in node:readline
// (transcript parser), which breaks the browser bundle. Types are erased at build
// time, so `import type` above is safe; this small constant stays in sync manually.
const AXES: readonly { key: EfficioAxisKey; status: EfficioAxisStatus }[] = [
  { key: 'w2', status: 'subj' },
  { key: 'wc', status: 'obj-weak' },
  { key: 'bash', status: 'obj-weak' },
  { key: 'w3', status: 'none' },
];
const PRIMARY_AXIS: EfficioAxisKey = 'w2';

// Same origin convention as App.tsx: the server serves the UI in production and
// proxies in dev, so we target its HTTP port directly.
const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;
const SPARK_HEIGHT = 48;
const TIMELINE_LAST = 20;

const EMPTY_STATUS: EfficioStatus = {
  available: false,
  sessionCount: 0,
  modelVersion: null,
  modelN: null,
  lastScoredAt: null,
};

/** Percentile → color: higher waste = warmer. Mirrors the "waste↑" reading. */
function barColor(percentile: number): string {
  if (percentile >= 75) return 'var(--accent-red, #f85149)';
  if (percentile >= 50) return 'var(--accent-amber, #d29922)';
  return 'var(--accent-green, #3fb950)';
}

export function EfficioPanel() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<EfficioStatus>(EMPTY_STATUS);
  const [axis, setAxis] = useState<EfficioAxisKey>(PRIMARY_AXIS);
  const [rows, setRows] = useState<EfficioTimelineRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (which: EfficioAxisKey) => {
    setLoading(true);
    try {
      const [s, tl] = await Promise.all([
        fetch(`${API_BASE}/api/efficio/status`).then((r) => r.json() as Promise<EfficioStatus>),
        fetch(`${API_BASE}/api/efficio/timeline?axis=${which}&last=${TIMELINE_LAST}`).then(
          (r) => r.json() as Promise<{ rows: EfficioTimelineRow[] }>,
        ),
      ]);
      setStatus(s);
      setRows(tl.rows ?? []);
    } catch {
      setStatus(EMPTY_STATUS);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(axis);
  }, [axis, refresh]);

  const maxPct = Math.max(1, ...rows.map((r) => r.wastePercentile));
  const lastUpdated = status.lastScoredAt
    ? new Date(status.lastScoredAt * 1000).toLocaleString(i18n.language === 'ko' ? 'ko-KR' : 'en-US')
    : null;

  return (
    <div
      className="border rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <div
        className="px-4 py-3 text-[12px] font-semibold border-b flex items-center justify-between gap-2"
        style={{
          color: 'var(--text-secondary)',
          borderColor: 'var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        <span className="shrink-0">{t('efficio.title')}</span>
        <button
          onClick={() => void refresh(axis)}
          disabled={loading}
          className="text-[10px] px-2 py-0.5 rounded-md transition-colors"
          style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
        >
          {loading ? t('efficio.loading') : t('efficio.refresh')}
        </button>
      </div>

      {!status.available ? (
        <div className="px-4 py-5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <div className="mb-2">{t('efficio.empty')}</div>
          <code
            className="block px-2 py-1.5 rounded-md text-[10px]"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
          >
            python3 -m efficio collect
          </code>
        </div>
      ) : (
        <>
          {/* Axis selector */}
          <div className="px-3 pt-3 flex flex-wrap gap-1">
            {AXES.map((a) => (
              <button
                key={a.key}
                onClick={() => setAxis(a.key)}
                className="text-[10px] px-2 py-1 rounded-md transition-colors"
                style={{
                  background: a.key === axis ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                  color: a.key === axis ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                }}
                title={t(`efficio.status.${a.status}`)}
              >
                {t(`efficio.axis.${a.key}`)}
              </button>
            ))}
          </div>

          {/* Sparkline: waste percentile over recent sessions (left=older) */}
          <div className="px-4 py-3 flex items-end gap-px" style={{ height: SPARK_HEIGHT + 16 }}>
            {rows.length === 0 ? (
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                {t('efficio.noData')}
              </span>
            ) : (
              rows.map((r) => (
                <div
                  key={r.sessionId}
                  className="rounded-sm transition-all duration-300"
                  title={`${r.title} · ${Math.round(r.wastePercentile)}%`}
                  style={{
                    height: Math.max(3, (r.wastePercentile / maxPct) * SPARK_HEIGHT),
                    background: barColor(r.wastePercentile),
                    opacity: 0.85,
                    flex: '1 1 0',
                  }}
                />
              ))
            )}
          </div>

          {/* Footer meta */}
          <div
            className="px-4 py-2 text-[10px] border-t flex items-center justify-between"
            style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}
          >
            <span>{t('efficio.sessions', { count: status.sessionCount })}</span>
            {lastUpdated && <span title={t('efficio.lastUpdated')}>{lastUpdated}</span>}
          </div>
        </>
      )}
    </div>
  );
}

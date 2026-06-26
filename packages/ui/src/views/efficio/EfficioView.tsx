import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EfficioAxisKey,
  EfficioProfiles,
  EfficioSessionProfile,
  EfficioStatus,
} from '@claude-alive/core';
import { AXES, PRIMARY_AXIS, wasteColor } from './axes.ts';
import { ScatterPlot } from './ScatterPlot.tsx';
import { MultiAxisTimeline } from './MultiAxisTimeline.tsx';
import { DistributionHistogram } from './DistributionHistogram.tsx';
import { SessionDetailCard } from './SessionDetailCard.tsx';

// Same origin convention as App.tsx / EfficioPanel: server serves UI and proxies in dev.
const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;
const LAST = 80;

type Tab = 'sessions' | 'scatter' | 'timeline' | 'distribution';
const TABS: Tab[] = ['sessions', 'scatter', 'timeline', 'distribution'];

const EMPTY_STATUS: EfficioStatus = {
  available: false,
  sessionCount: 0,
  modelVersion: null,
  modelN: null,
  lastScoredAt: null,
};

interface EfficioViewProps {
  active: boolean;
}

export function EfficioView({ active }: EfficioViewProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<EfficioStatus>(EMPTY_STATUS);
  const [profiles, setProfiles] = useState<EfficioProfiles>({ modelVersion: null, sessions: [] });
  const [axis, setAxis] = useState<EfficioAxisKey>(PRIMARY_AXIS);
  const [tab, setTab] = useState<Tab>('sessions');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        fetch(`${API_BASE}/api/efficio/status`).then((r) => r.json() as Promise<EfficioStatus>),
        fetch(`${API_BASE}/api/efficio/profiles?last=${LAST}`).then((r) => r.json() as Promise<EfficioProfiles>),
      ]);
      setStatus(s);
      setProfiles(p);
    } catch {
      setStatus(EMPTY_STATUS);
      setProfiles({ modelVersion: null, sessions: [] });
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  // Lazy-load on first activation only (mounted-but-hidden until tab opened).
  useEffect(() => {
    if (active && !loaded) void refresh();
  }, [active, loaded, refresh]);

  const sessions = profiles.sessions;
  const selected = useMemo(
    () => sessions.find((s) => s.sessionId === selectedId) ?? null,
    [sessions, selectedId],
  );

  // Newest first for the list (profiles arrive oldest→newest for charts).
  const listSessions = useMemo(() => [...sessions].reverse(), [sessions]);

  return (
    <div className="h-full overflow-auto" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-[1200px] mx-auto px-6 py-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-1">
          <div>
            <h1 className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>
              {t('efficio.title')}
            </h1>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {t('efficio.view.subtitle')}
            </p>
          </div>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="text-[11px] px-3 py-1.5 rounded-md shrink-0"
            style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
          >
            {loading ? t('efficio.loading') : t('efficio.refresh')}
          </button>
        </div>

        {!status.available ? (
          <div className="border rounded-xl px-5 py-8 mt-4 text-[12px]" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            <div className="mb-3">{t('efficio.empty')}</div>
            <code className="block px-3 py-2 rounded-md text-[11px]" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              python3 -m efficio collect
            </code>
          </div>
        ) : (
          <>
            {/* Meta + caveat */}
            <div className="flex flex-wrap items-center gap-3 text-[10px] mt-2 mb-3" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              <span>{t('efficio.view.model', { version: status.modelVersion ?? '?' })}</span>
              <span>·</span>
              <span>{t('efficio.view.count', { count: status.sessionCount })}</span>
              <span>·</span>
              <span>{t('efficio.view.last', { count: sessions.length })}</span>
            </div>
            <p className="text-[10px] mb-4 leading-relaxed" style={{ color: 'var(--text-secondary)', opacity: 0.85 }}>
              {t('efficio.view.caveat')}
            </p>

            {/* Axis selector */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {AXES.map((a) => (
                <button
                  key={a.key}
                  onClick={() => setAxis(a.key)}
                  className="text-[11px] px-2.5 py-1 rounded-md"
                  title={t(`efficio.status.${a.status}`)}
                  style={{
                    background: a.key === axis ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                    color: a.key === axis ? '#fff' : 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {t(`efficio.axis.${a.key}`)}
                </button>
              ))}
            </div>

            {/* Tabs */}
            <div role="tablist" className="flex gap-1 mb-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              {TABS.map((tk) => {
                const isActive = tk === tab;
                return (
                  <button
                    key={tk}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setTab(tk)}
                    className="text-[12px] px-3 py-2 font-medium"
                    style={{
                      color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      borderBottom: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
                    }}
                  >
                    {t(`efficio.view.tab.${tk}`)}
                  </button>
                );
              })}
            </div>

            {/* Body: session list (left) + active chart + detail card */}
            <div className="flex gap-4 items-start flex-wrap lg:flex-nowrap">
              {/* Session list */}
              <div
                className="border rounded-xl overflow-hidden shrink-0 w-full lg:w-[240px]"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
              >
                <div className="max-h-[460px] overflow-auto">
                  {listSessions.map((s) => (
                    <SessionRow
                      key={s.sessionId}
                      session={s}
                      axis={axis}
                      selected={s.sessionId === selectedId}
                      onClick={() => setSelectedId(s.sessionId)}
                    />
                  ))}
                </div>
              </div>

              {/* Active chart */}
              <div
                className="border rounded-xl p-4 flex-1 min-w-0"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
              >
                {tab === 'scatter' && (
                  <ScatterPlot sessions={sessions} axis={axis} selectedId={selectedId} onSelect={setSelectedId} />
                )}
                {tab === 'timeline' && (
                  <MultiAxisTimeline sessions={sessions} selectedId={selectedId} onSelect={setSelectedId} />
                )}
                {tab === 'distribution' && (
                  <DistributionHistogram sessions={sessions} axis={axis} selectedId={selectedId} />
                )}
                {tab === 'sessions' && <SessionDetailCard session={selected} />}
              </div>

              {/* Detail card alongside non-sessions tabs */}
              {tab !== 'sessions' && (
                <div className="w-full lg:w-[300px] shrink-0">
                  <SessionDetailCard session={selected} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface SessionRowProps {
  session: EfficioSessionProfile;
  axis: EfficioAxisKey;
  selected: boolean;
  onClick: () => void;
}

function SessionRow({ session, axis, selected, onClick }: SessionRowProps) {
  const sc = session.axes[axis];
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 border-b flex items-center gap-2"
      style={{
        borderColor: 'var(--border-color)',
        background: selected ? 'var(--bg-secondary)' : 'transparent',
      }}
    >
      <span className="w-1.5 h-6 rounded-full shrink-0" style={{ background: wasteColor(sc.wastePercentile) }} />
      <span className="flex-1 min-w-0 truncate text-[11px]" style={{ color: 'var(--text-primary)' }} title={session.title}>
        {session.title}
      </span>
      <span className="text-[10px] shrink-0" style={{ color: wasteColor(sc.wastePercentile), fontFamily: 'var(--font-mono)' }}>
        {sc.isZero ? '—' : `${Math.round(sc.wastePercentile)}%`}
      </span>
    </button>
  );
}

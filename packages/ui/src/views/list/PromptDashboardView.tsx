import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TierBadge, ConfidenceBadge } from './promptBadges';
import {
  TIER_COLOR,
  SEVERITY_COLOR,
  fmtTime,
  type PromptListRow,
  type PromptStats,
} from './promptTypes';

interface PromptDashboardViewProps {
  /** Parent toggles display: 'none' / 'block' instead of unmounting. */
  active: boolean;
  /** Switch to the prompts sub-tab and focus a specific prompt id. */
  onSelectPrompt: (id: string) => void;
}

const TIER_ORDER: Array<keyof typeof TIER_COLOR> = ['good', 'ok', 'weak', 'bad'];

/**
 * Daily combo chart for the last 30 days. Two synchronized series on
 * one x-axis:
 *   • bars (left axis, count):       prompts captured per day
 *   • line (right axis, 0–100):      average final_score per day
 * Bars use a dedicated count scale so they never get crushed by sparse
 * low-volume days; the score line keeps a fixed 0–100 domain so users
 * can compare absolute quality across the window. X-axis labels are
 * drawn for ~6 evenly spaced days to avoid overlap on narrow widths.
 *
 * Layout is pixel-based (not viewBox scaling) because mixing rectangles
 * and text in a stretched viewBox distorts both. We measure the
 * container with ResizeObserver and redraw on width changes.
 */
function ScoreCountChart({ daily }: { daily: PromptStats['daily'] }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth || 600);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (daily.length === 0) {
    return (
      <div
        ref={containerRef}
        style={{
          height: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontSize: 12,
        }}
      >
        no data
      </div>
    );
  }

  const HEIGHT = 200;
  const PADDING = { top: 12, right: 44, bottom: 28, left: 36 };
  const innerW = Math.max(width - PADDING.left - PADDING.right, 40);
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  const maxCount = Math.max(1, ...daily.map((d) => d.count));
  // Slot each day on the x-axis with even spacing; bars are slightly
  // narrower than the slot for visual breathing room.
  const slotW = innerW / daily.length;
  const barW = Math.max(2, slotW * 0.7);

  const yCount = (c: number) => innerH - (c / maxCount) * innerH;
  const yScore = (s: number) => innerH - (s / 100) * innerH;
  const xCenter = (i: number) => i * slotW + slotW / 2;

  const linePoints = daily
    .map((d, i) =>
      d.avg_score != null
        ? `${xCenter(i).toFixed(1)},${yScore(d.avg_score).toFixed(1)}`
        : null
    )
    .filter(Boolean) as string[];

  // Pick ~6 x-axis labels evenly spaced (or fewer if not enough days).
  const labelCount = Math.min(6, daily.length);
  const labelEvery = Math.max(1, Math.round(daily.length / labelCount));
  const labelIndices = daily
    .map((_, i) => i)
    .filter((i) => i % labelEvery === 0 || i === daily.length - 1);

  function fmtDay(day: string): string {
    // SQLite date() emits YYYY-MM-DD; show MM/DD for compactness.
    const parts = day.split('-');
    if (parts.length === 3) return `${parts[1]}/${parts[2]}`;
    return day;
  }

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg width={width} height={HEIGHT} style={{ display: 'block' }}>
        <g transform={`translate(${PADDING.left}, ${PADDING.top})`}>
          {/* Y-axis gridlines: 0, 25, 50, 75, 100 on the score scale. */}
          {[0, 25, 50, 75, 100].map((v) => {
            const y = yScore(v);
            return (
              <g key={v}>
                <line
                  x1={0}
                  y1={y}
                  x2={innerW}
                  y2={y}
                  stroke="var(--border-color)"
                  strokeWidth={0.5}
                  strokeDasharray="2,3"
                  opacity={v === 0 ? 1 : 0.6}
                />
                <text
                  x={-6}
                  y={y + 3}
                  fontSize={9}
                  fontFamily="var(--font-mono)"
                  fill="var(--text-secondary)"
                  textAnchor="end"
                >
                  {v}
                </text>
              </g>
            );
          })}

          {/* Right-side count axis ticks: 0, mid, max. */}
          {[0, Math.round(maxCount / 2), maxCount].map((c, idx) => (
            <text
              key={`ct-${idx}`}
              x={innerW + 6}
              y={yCount(c) + 3}
              fontSize={9}
              fontFamily="var(--font-mono)"
              fill="var(--accent-amber)"
              opacity={0.75}
            >
              {c}
            </text>
          ))}

          {/* Bars (count). Amber so they read as a different series
              from the blue score line, matching the legend below. */}
          {daily.map((d, i) => {
            const h = innerH - yCount(d.count);
            return (
              <rect
                key={`bar-${i}`}
                x={xCenter(i) - barW / 2}
                y={yCount(d.count)}
                width={barW}
                height={h}
                fill="var(--accent-amber)"
                opacity={0.55}
                rx={1}
              >
                <title>{`${d.day} · ${d.count} prompts · avg ${
                  d.avg_score != null ? Math.round(d.avg_score) : '—'
                }`}</title>
              </rect>
            );
          })}

          {/* Score line + dots over the bars. */}
          {linePoints.length > 1 && (
            <polyline
              points={linePoints.join(' ')}
              fill="none"
              stroke="var(--accent-blue)"
              strokeWidth={1.5}
            />
          )}
          {daily.map((d, i) =>
            d.avg_score != null ? (
              <circle
                key={`pt-${i}`}
                cx={xCenter(i)}
                cy={yScore(d.avg_score)}
                r={2.5}
                fill="var(--accent-blue)"
                stroke="var(--bg-secondary)"
                strokeWidth={1}
              >
                <title>{`${d.day} · score ${Math.round(d.avg_score)}`}</title>
              </circle>
            ) : null
          )}

          {/* X-axis date labels. */}
          {labelIndices.map((i) => (
            <text
              key={`xl-${i}`}
              x={xCenter(i)}
              y={innerH + 16}
              fontSize={9}
              fontFamily="var(--font-mono)"
              fill="var(--text-secondary)"
              textAnchor="middle"
            >
              {fmtDay(daily[i]!.day)}
            </text>
          ))}
        </g>
      </svg>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginTop: 4,
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 2,
              background: 'var(--accent-blue)',
              display: 'inline-block',
            }}
          />
          {t('prompt.dashboard.legendScore', { defaultValue: '평균 점수 (0–100)' })}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              background: 'var(--accent-amber)',
              opacity: 0.55,
              display: 'inline-block',
              borderRadius: 1,
            }}
          />
          {t('prompt.dashboard.legendCount', { defaultValue: '프롬프트 횟수' })}
        </span>
      </div>
    </div>
  );
}

/**
 * Tier distribution as a stacked horizontal bar. Same color tokens as
 * the inline tier badges so the user reads the bar segments as the
 * same categories.
 */
function TierBar({ distribution }: { distribution: Record<string, number> }) {
  const total = TIER_ORDER.reduce((s, t) => s + (distribution[t] ?? 0), 0);
  if (total === 0) {
    return (
      <div style={{ height: 12, background: 'var(--bg-secondary)', borderRadius: 6 }} />
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        height: 12,
        width: '100%',
        borderRadius: 6,
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
      }}
    >
      {TIER_ORDER.map((tier) => {
        const count = distribution[tier] ?? 0;
        if (count === 0) return null;
        const pct = (count / total) * 100;
        return (
          <div
            key={tier}
            title={`${tier}: ${count} (${pct.toFixed(0)}%)`}
            style={{
              width: `${pct}%`,
              background: TIER_COLOR[tier],
            }}
          />
        );
      })}
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 140,
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        padding: '16px 18px',
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 28,
          fontWeight: 700,
          color: 'var(--text-primary)',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.75 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function PromptDashboardView({ active, onSelectPrompt }: PromptDashboardViewProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PromptStats | null>(null);
  const [recent, setRecent] = useState<PromptListRow[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [statsRes, recentRes] = await Promise.all([
        fetch('/api/prompts/stats'),
        fetch('/api/prompts?limit=12'),
      ]);
      if (statsRes.ok) setStats((await statsRes.json()) as PromptStats);
      if (recentRes.ok) {
        const data = (await recentRes.json()) as { prompts: PromptListRow[] };
        setRecent(data.prompts);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [active, refresh]);

  if (!loaded) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-secondary)',
          fontSize: 13,
        }}
      >
        {t('prompt.loading')}
      </div>
    );
  }

  const avgScore = stats?.avg_score != null ? Math.round(stats.avg_score) : null;
  const total = stats?.total ?? 0;
  const tierDist = stats?.tier_distribution ?? { good: 0, ok: 0, weak: 0, bad: 0 };
  const goodPct = total > 0 ? Math.round(((tierDist.good ?? 0) / total) * 100) : 0;

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      {/* Top metric cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <MetricCard
          label={t('prompt.dashboard.totalPrompts', { defaultValue: '전체 프롬프트' })}
          value={total.toLocaleString()}
        />
        <MetricCard
          label={t('prompt.dashboard.avgScore', { defaultValue: '평균 점수' })}
          value={avgScore != null ? String(avgScore) : '—'}
          hint={t('prompt.dashboard.avgScoreHint', { defaultValue: '0–100 스케일' })}
        />
        <MetricCard
          label={t('prompt.dashboard.goodRatio', { defaultValue: 'GOOD 비율' })}
          value={`${goodPct}%`}
          hint={`${tierDist.good ?? 0} / ${total}`}
        />
        <MetricCard
          label={t('prompt.dashboard.activeDays', { defaultValue: '활동 일수 (30d)' })}
          value={String(stats?.daily.length ?? 0)}
        />
      </div>

      {/* Score sparkline + tier distribution */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div
          style={{
            flex: 2,
            minWidth: 320,
            border: '1px solid var(--border-color)',
            borderRadius: 12,
            padding: 16,
            background: 'var(--bg-secondary)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 12,
            }}
          >
            {t('prompt.dashboard.scoreTrend', { defaultValue: '점수 추이 (최근 30일)' })}
          </div>
          <ScoreCountChart daily={stats?.daily ?? []} />
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 240,
            border: '1px solid var(--border-color)',
            borderRadius: 12,
            padding: 16,
            background: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {t('prompt.dashboard.tierDistribution', { defaultValue: 'Tier 분포' })}
          </div>
          <TierBar distribution={tierDist} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {TIER_ORDER.map((tier) => {
              const c = tierDist[tier] ?? 0;
              const pct = total > 0 ? Math.round((c / total) * 100) : 0;
              return (
                <div
                  key={tier}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: TIER_COLOR[tier],
                    }}
                  />
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                      color: 'var(--text-secondary)',
                      letterSpacing: '0.06em',
                      flex: 1,
                    }}
                  >
                    {tier}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {c}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      width: 36,
                      textAlign: 'right',
                    }}
                  >
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top improvement areas — aggregated rule hits */}
      <div
        style={{
          border: '1px solid var(--border-color)',
          borderRadius: 12,
          padding: 16,
          background: 'var(--bg-secondary)',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 12,
          }}
        >
          {t('prompt.dashboard.topImprovements', {
            defaultValue: '자주 발생하는 개선사항',
          })}
        </div>
        {!stats || stats.top_rules.length === 0 ? (
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              padding: '8px 0',
            }}
          >
            {t('prompt.dashboard.topImprovementsEmpty', {
              defaultValue: '아직 룰 hit이 없습니다.',
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stats.top_rules.map((r) => {
              const color =
                SEVERITY_COLOR[Math.round(r.max_severity)] ?? 'var(--text-secondary)';
              return (
                <div
                  key={r.rule_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 10px',
                    borderLeft: `3px solid ${color}`,
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      fontWeight: 700,
                      color,
                      minWidth: 56,
                    }}
                  >
                    {r.rule_id}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.sample_message}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {r.hits}×
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent prompts as cards. Clicking jumps to the Prompts sub-tab
          with the row preselected. */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 12,
          }}
        >
          {t('prompt.dashboard.recentCards', { defaultValue: '최근 프롬프트' })}
        </div>
        {!recent || recent.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('prompt.empty')}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
            }}
          >
            {recent.map((row) => (
              <button
                key={row.id}
                onClick={() => onSelectPrompt(row.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 14,
                  border: '1px solid var(--border-color)',
                  borderRadius: 10,
                  background: 'var(--bg-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'transform 0.15s ease, border-color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.borderColor = 'var(--accent-blue)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 18,
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {row.final_score ?? '—'}
                  </span>
                  <TierBadge tier={row.tier} />
                  <ConfidenceBadge
                    confidence={row.confidence}
                    delta={row.baseline_delta}
                  />
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.4,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {row.prompt}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    opacity: 0.6,
                    marginTop: 'auto',
                  }}
                >
                  {fmtTime(row.created_at)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

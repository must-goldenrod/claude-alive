import { useTranslation } from 'react-i18next';
import type { EfficioAxisKey, EfficioSessionProfile } from '@claude-alive/core';
import { wasteColor, compact } from './axes.ts';

interface ScatterPlotProps {
  sessions: readonly EfficioSessionProfile[];
  axis: EfficioAxisKey;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const W = 720;
const H = 360;
const PAD = { top: 16, right: 16, bottom: 40, left: 56 };

/**
 * 크기(x=tokens) vs 잔차(y=residual) 산점도. y=0이 회귀 기준선(반사실 예상).
 * 점이 선 위면 "크기 예상보다 낭비 많음". 점 색=낭비 백분위.
 */
export function ScatterPlot({ sessions, axis, selectedId, onSelect }: ScatterPlotProps) {
  const { t } = useTranslation();
  const pts = sessions.map((s) => ({
    s,
    x: Math.max(1, s.totalTokens),
    y: s.axes[axis].residual,
  }));
  if (pts.length === 0) return null;

  // x는 로그 스케일(토큰 분포가 크게 치우침), y는 선형(0 대칭).
  const xs = pts.map((p) => Math.log10(p.x));
  const ys = pts.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yAbs = Math.max(1, ...ys.map((v) => Math.abs(v)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const sx = (lx: number) => PAD.left + ((lx - xMin) / (xMax - xMin || 1)) * innerW;
  const sy = (y: number) => PAD.top + innerH / 2 - (y / yAbs) * (innerH / 2);
  const zeroY = sy(0);

  return (
    <div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-secondary)' }}>
        {t('efficio.view.scatterHint')}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }}>
        {/* 기준선 y=0 (회귀 예상) */}
        <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} stroke="var(--accent-blue)" strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
        <text x={W - PAD.right} y={zeroY - 5} textAnchor="end" fontSize={10} fill="var(--accent-blue)">
          {t('efficio.view.expected')}
        </text>
        {/* 축 라벨 */}
        <text x={PAD.left + innerW / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
          {t('efficio.view.scatterX')}
        </text>
        <text x={14} y={PAD.top + innerH / 2} textAnchor="middle" fontSize={11} fill="var(--text-secondary)" transform={`rotate(-90 14 ${PAD.top + innerH / 2})`}>
          {t('efficio.view.scatterY')}
        </text>
        {/* 점 */}
        {pts.map((p) => {
          const selected = p.s.sessionId === selectedId;
          return (
            <circle
              key={p.s.sessionId}
              cx={sx(Math.log10(p.x))}
              cy={sy(p.y)}
              r={selected ? 6 : 4}
              fill={wasteColor(p.s.axes[axis].wastePercentile)}
              stroke={selected ? 'var(--text-primary)' : 'none'}
              strokeWidth={selected ? 1.5 : 0}
              opacity={selectedId && !selected ? 0.4 : 0.85}
              style={{ cursor: 'pointer', transition: 'r 120ms, opacity 120ms' }}
              onClick={() => onSelect(p.s.sessionId)}
            >
              <title>{`${p.s.title} · ${compact(p.x)} tok · ${t('efficio.view.residual')} ${compact(p.y)} · ${Math.round(p.s.axes[axis].wastePercentile)}%`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EfficioSessionProfile } from '@claude-alive/core';

interface ImprovementCandidatesProps {
  sessions: readonly EfficioSessionProfile[];
  onSelect: (id: string) => void;
}

interface Aggregated {
  item: string;
  totalCount: number; // 전 세션 반복 횟수 합
  sessionCount: number; // 반복이 나타난 세션 수
  sampleId: string; // 대표 세션(클릭 시 이동)
}

/** 한 종류(bash/edit)의 반복을 코퍼스 전체로 집계 — 여러 세션에 걸친 반복일수록 규칙 후보 가치↑. */
function aggregate(
  sessions: readonly EfficioSessionProfile[],
  pick: (s: EfficioSessionProfile) => readonly { item: string; count: number }[],
): Aggregated[] {
  const map = new Map<string, Aggregated>();
  for (const s of sessions) {
    for (const r of pick(s)) {
      const cur = map.get(r.item);
      if (cur) {
        cur.totalCount += r.count;
        cur.sessionCount += 1;
      } else {
        map.set(r.item, { item: r.item, totalCount: r.count, sessionCount: 1, sampleId: s.sessionId });
      }
    }
  }
  // 여러 세션에 걸친 것 우선, 그다음 총 반복량.
  return [...map.values()].sort(
    (a, b) => b.sessionCount - a.sessionCount || b.totalCount - a.totalCount,
  );
}

/**
 * 개선 후보(L1) — 백분위(평가)가 아니라 *무엇을* 반복했는지의 사실을 코퍼스 전체로 모은다.
 * 여러 세션에 반복되는 명령/파일일수록 CLAUDE.md 규칙 후보 가치가 크다.
 */
export function ImprovementCandidates({ sessions, onSelect }: ImprovementCandidatesProps) {
  const { t } = useTranslation();
  const bash = useMemo(() => aggregate(sessions, (s) => s.topBash).slice(0, 15), [sessions]);
  const edits = useMemo(() => aggregate(sessions, (s) => s.topEdits).slice(0, 15), [sessions]);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {t('efficio.view.candHint')}
      </p>
      <CandList title={t('efficio.view.candBash')} rows={bash} onSelect={onSelect} t={t} />
      <CandList title={t('efficio.view.candEdits')} rows={edits} onSelect={onSelect} t={t} />
    </div>
  );
}

interface CandListProps {
  title: string;
  rows: Aggregated[];
  onSelect: (id: string) => void;
  t: (k: string, o?: Record<string, unknown>) => string;
}

function CandList({ title, rows, onSelect, t }: CandListProps) {
  return (
    <div>
      <div className="text-[12px] font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {t('efficio.view.candNone')}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((r) => (
            <button
              key={r.item}
              onClick={() => onSelect(r.sampleId)}
              className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
            >
              <span
                className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md"
                style={{
                  background: r.sessionCount > 1 ? 'var(--accent-red, #f85149)' : 'var(--bg-card)',
                  color: r.sessionCount > 1 ? '#fff' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
                title={t('efficio.view.candAcross', { sessions: r.sessionCount, total: r.totalCount })}
              >
                ×{r.totalCount}
              </span>
              <code
                className="flex-1 min-w-0 truncate text-[11px]"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                title={r.item}
              >
                {r.item}
              </code>
              <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                {t('efficio.view.candSessions', { count: r.sessionCount })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

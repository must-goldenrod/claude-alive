/**
 * Efficio 축 메타의 로컬 미러 + 시각화 헬퍼.
 *
 * EfficioPanel.tsx와 같은 이유로 @claude-alive/core의 런타임 값(EFFICIO_AXES)을
 * import하지 않는다: core 런타임 엔트리가 node:readline(transcript 파서)을 끌어와
 * 브라우저 번들을 깬다. 타입은 빌드 시 지워지므로 `import type`만 안전 — 이 작은
 * 상수는 core/efficio/types.ts의 EFFICIO_AXES와 수동으로 동기화한다.
 */
import type { EfficioAxisKey, EfficioAxisStatus, EfficioCluster } from '@claude-alive/core';

export interface AxisMeta {
  key: EfficioAxisKey;
  status: EfficioAxisStatus;
  cluster: EfficioCluster;
}

export const AXES: readonly AxisMeta[] = [
  { key: 'w2', status: 'subj', cluster: 'perceived' },
  { key: 'wc', status: 'obj-weak', cluster: 'behavioral' },
  { key: 'bash', status: 'obj-weak', cluster: 'behavioral' },
  { key: 'w3', status: 'none', cluster: 'behavioral' },
] as const;

export const PRIMARY_AXIS: EfficioAxisKey = 'w2';

/** 백분위 → 색: 높을수록 따뜻(낭비↑). "낭비↑" 읽기와 일치. */
export function wasteColor(percentile: number): string {
  if (percentile >= 75) return 'var(--accent-red, #f85149)';
  if (percentile >= 50) return 'var(--accent-amber, #d29922)';
  return 'var(--accent-green, #3fb950)';
}

/** 큰 수를 1.2M / 34K 형태로. 토큰·신호값 표시용. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${Math.round(n)}`;
}

/**
 * Efficio 제품 통합 타입 — 읽기 브리지(server)와 UI가 공유.
 *
 * efficio(Python)가 ~/.efficio/efficio.db에 점수를 영속화하고, server는 그것을
 * read-only로 읽어 이 타입으로 노출한다. server는 통계를 재계산하지 않는다
 * (드리프트 단일출처는 efficio Python). 축 메타는 efficio/reference.py의 AXES와
 * 동기화 — label은 i18n이므로 여기엔 두지 않고 key/status/cluster만 둔다.
 */

export type EfficioAxisKey = 'w2' | 'wc' | 'bash' | 'w3';

/** 검증 상태: 주관(H1)·객관약·미검증. efficio reference.py status와 일치. */
export type EfficioAxisStatus = 'subj' | 'obj-weak' | 'none';

/** 2차원 축군(13.5 MTMM): 체감(perceived) vs 행동(behavioral). */
export type EfficioCluster = 'perceived' | 'behavioral';

export interface EfficioAxisMeta {
  key: EfficioAxisKey;
  status: EfficioAxisStatus;
  cluster: EfficioCluster;
}

/** efficio/reference.py AXES의 정적 미러(라벨 제외 — UI i18n에서 번역). PRIMARY=w2. */
export const EFFICIO_AXES: readonly EfficioAxisMeta[] = [
  { key: 'w2', status: 'subj', cluster: 'perceived' },
  { key: 'wc', status: 'obj-weak', cluster: 'behavioral' },
  { key: 'bash', status: 'obj-weak', cluster: 'behavioral' },
  { key: 'w3', status: 'none', cluster: 'behavioral' },
] as const;

export const EFFICIO_PRIMARY_AXIS: EfficioAxisKey = 'w2';

/** 데이터 가용성·기준모델 메타. DB 부재 시 available=false. */
export interface EfficioStatus {
  available: boolean;
  sessionCount: number;
  modelVersion: number | null;
  modelN: number | null;
  /** 마지막 채점 시각(epoch seconds) = 마지막 collect/fit. */
  lastScoredAt: number | null;
}

export interface EfficioTimelineRow {
  /** full session id (UI에서 접두어로 잘라 표시). */
  sessionId: string;
  title: string;
  /** epoch seconds. */
  tsFirst: number;
  residual: number;
  /** 0~100, 높을수록 낭비 의심(자기대비 백분위). */
  wastePercentile: number;
}

export interface EfficioTimeline {
  axis: EfficioAxisKey;
  rows: EfficioTimelineRow[];
}

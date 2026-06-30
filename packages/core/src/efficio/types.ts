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

/**
 * 한 축의 채점값(고정 기준모델 적용). server는 scores 테이블을 읽기만 하고
 * 재계산하지 않는다 — actual/baseline/residual/wastePercentile 전부 efficio가 영속화한 값.
 */
export interface EfficioAxisScore {
  /** 실제 신호값(크기 미보정 raw). */
  actual: number;
  /** 같은 크기 세션의 회귀 예상값(반사실 기준선). */
  baseline: number;
  /** actual − baseline (크기 보정 잔차). */
  residual: number;
  /** 0~100, 높을수록 낭비 의심(자기대비 백분위). */
  wastePercentile: number;
  /** raw 신호가 0(신호 없음) — 백분위 해석에서 구분. */
  isZero: boolean;
}

/**
 * 반복된 구체 항목(개선 후보, L1). 백분위(평가)가 아니라 *무엇을* 반복했는지의 사실 —
 * 검증·언어 무관하게 actionable해 CLAUDE.md 규칙 후보로 직접 쓰인다.
 */
export interface EfficioRepeat {
  /** 반복된 Bash 명령(앞 60자 정규화) 또는 편집 파일 경로. */
  item: string;
  /** 같은 세션 내 반복 횟수(≥2). */
  count: number;
}

/** 한 세션의 4축 동시 프로파일 + 크기 메타. 상세카드·산점도·분포·다축시계열의 단일 데이터원. */
export interface EfficioSessionProfile {
  sessionId: string;
  title: string;
  project: string | null;
  /** epoch seconds. */
  tsFirst: number;
  turns: number;
  totalTokens: number;
  /** 축키 → 채점값. efficio가 4축 모두 채우므로 누락 축 없음. */
  axes: Record<EfficioAxisKey, EfficioAxisScore>;
  /** 2회 이상 반복한 Bash 명령 top-3(개선 후보). 반복 없으면 빈 배열. */
  topBash: EfficioRepeat[];
  /** 2회 이상 반복 편집한 파일 top-3(개선 후보). 반복 없으면 빈 배열. */
  topEdits: EfficioRepeat[];
}

export interface EfficioProfiles {
  modelVersion: number | null;
  sessions: EfficioSessionProfile[];
}

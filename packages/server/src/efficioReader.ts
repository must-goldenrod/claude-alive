/**
 * Efficio 읽기 브리지 — ~/.efficio/efficio.db를 read-only로 읽어 제품에 노출.
 *
 * 설계 원칙: server는 통계를 절대 재계산하지 않는다. efficio(Python)가 collect/fit
 * 시점에 scores 테이블까지 채워두고, 여기서는 그 결과를 JOIN해 읽기만 한다
 * (드리프트 단일출처 = efficio). DB가 없거나 구버전(scores 테이블 부재)이면
 * available=false로 graceful 처리 — UI는 `collect` 실행을 안내한다.
 *
 * 핸들을 캐싱하지 않고 매 요청마다 열고 닫는다: efficio collect가 동시에 쓰기를
 * 할 수 있으므로 항상 최신 스냅샷을 읽고, read-only라 쓰기 잠금 경합이 없다.
 */
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { EFFICIO_PRIMARY_AXIS } from '@claude-alive/core';
import type {
  EfficioAxisKey,
  EfficioAxisScore,
  EfficioProfiles,
  EfficioSessionProfile,
  EfficioStatus,
  EfficioTimeline,
  EfficioTimelineRow,
} from '@claude-alive/core';

export const DEFAULT_EFFICIO_DB = join(homedir(), '.efficio', 'efficio.db');

const VALID_AXES = new Set<EfficioAxisKey>(['w2', 'wc', 'bash', 'w3']);
const MAX_TIMELINE = 200;

const UNAVAILABLE: EfficioStatus = {
  available: false,
  sessionCount: 0,
  modelVersion: null,
  modelN: null,
  lastScoredAt: null,
};

export interface EfficioReader {
  readonly dbPath: string;
  status(): EfficioStatus;
  timeline(axis: string, last: number): EfficioTimeline;
  /** 최근 last개 세션의 4축 동시 프로파일 + 크기. 상세카드·산점도·분포·다축시계열 단일 데이터원. */
  profiles(last: number): EfficioProfiles;
}

const ALL_AXES: readonly EfficioAxisKey[] = ['w2', 'wc', 'bash', 'w3'];

/** scores 한 행을 축 채점값으로. NULL은 0으로 방어(구버전 DB·결측). */
function toAxisScore(row: {
  actual: number | null;
  baseline: number | null;
  residual: number | null;
  wastePercentile: number | null;
  isZero: number | null;
}): EfficioAxisScore {
  return {
    actual: row.actual ?? 0,
    baseline: row.baseline ?? 0,
    residual: row.residual ?? 0,
    wastePercentile: row.wastePercentile ?? 0,
    isZero: (row.isZero ?? 0) !== 0,
  };
}

export function createEfficioReader(dbPath: string = DEFAULT_EFFICIO_DB): EfficioReader {
  function open(): DatabaseSync | null {
    if (!existsSync(dbPath)) return null;
    try {
      return new DatabaseSync(dbPath, { readOnly: true });
    } catch {
      return null;
    }
  }

  function status(): EfficioStatus {
    const db = open();
    if (!db) return UNAVAILABLE;
    try {
      const cnt = db.prepare('SELECT COUNT(*) AS c FROM work_units').get() as { c: number };
      const model = db
        .prepare('SELECT id, n FROM reference_model ORDER BY id DESC LIMIT 1')
        .get() as { id: number; n: number } | undefined;
      const last = db.prepare('SELECT MAX(scored_at) AS t FROM scores').get() as { t: number | null };
      const lastScoredAt = last?.t ?? null;
      return {
        available: lastScoredAt !== null && cnt.c > 0,
        sessionCount: cnt.c,
        modelVersion: model?.id ?? null,
        modelN: model?.n ?? null,
        lastScoredAt,
      };
    } catch {
      // 구버전 DB(scores/reference_model 테이블 부재 등) → 데이터 없음으로 취급
      return UNAVAILABLE;
    } finally {
      db.close();
    }
  }

  function timeline(axis: string, last: number): EfficioTimeline {
    const resolved: EfficioAxisKey = VALID_AXES.has(axis as EfficioAxisKey)
      ? (axis as EfficioAxisKey)
      : EFFICIO_PRIMARY_AXIS;
    const limit = Math.min(Math.max(1, Math.trunc(last) || 20), MAX_TIMELINE);
    const db = open();
    if (!db) return { axis: resolved, rows: [] };
    try {
      const model = db.prepare('SELECT MAX(id) AS v FROM reference_model').get() as { v: number | null };
      if (model?.v == null) return { axis: resolved, rows: [] };
      const rows = db
        .prepare(
          `SELECT w.session_id AS sessionId,
                  COALESCE(w.ai_title, w.project, w.session_id) AS title,
                  w.ts_first AS tsFirst,
                  s.residual AS residual,
                  s.waste_percentile AS wastePercentile
             FROM scores s
             JOIN work_units w ON w.session_id = s.session_id
            WHERE s.axis = ? AND s.model_version = ?
            ORDER BY w.ts_first DESC
            LIMIT ?`,
        )
        .all(resolved, model.v, limit) as unknown as EfficioTimelineRow[];
      rows.reverse(); // 과거→현재 오름차순(차트 좌→우)
      return { axis: resolved, rows };
    } catch {
      return { axis: resolved, rows: [] };
    } finally {
      db.close();
    }
  }

  function profiles(last: number): EfficioProfiles {
    const limit = Math.min(Math.max(1, Math.trunc(last) || 50), MAX_TIMELINE);
    const db = open();
    if (!db) return { modelVersion: null, sessions: [] };
    try {
      const model = db.prepare('SELECT MAX(id) AS v FROM reference_model').get() as { v: number | null };
      if (model?.v == null) return { modelVersion: null, sessions: [] };

      // 최근 limit개 세션을 크기 메타와 함께. (이후 각 세션의 4축 점수를 JOIN으로 채움)
      const units = db
        .prepare(
          `SELECT w.session_id AS sessionId,
                  COALESCE(w.ai_title, w.project, w.session_id) AS title,
                  w.project AS project,
                  w.ts_first AS tsFirst,
                  w.turns AS turns,
                  w.total_tokens AS totalTokens
             FROM work_units w
             JOIN scores s ON s.session_id = w.session_id AND s.model_version = ?
            GROUP BY w.session_id
            ORDER BY w.ts_first DESC
            LIMIT ?`,
        )
        .all(model.v, limit) as unknown as Array<{
        sessionId: string;
        title: string;
        project: string | null;
        tsFirst: number;
        turns: number;
        totalTokens: number;
      }>;

      const scoreStmt = db.prepare(
        `SELECT axis, actual, baseline, residual,
                waste_percentile AS wastePercentile, is_zero AS isZero
           FROM scores WHERE session_id = ? AND model_version = ?`,
      );

      const sessions: EfficioSessionProfile[] = units.map((u) => {
        const scoreRows = scoreStmt.all(u.sessionId, model.v) as unknown as Array<{
          axis: EfficioAxisKey;
          actual: number | null;
          baseline: number | null;
          residual: number | null;
          wastePercentile: number | null;
          isZero: number | null;
        }>;
        const byAxis = new Map(scoreRows.map((r) => [r.axis, r]));
        const empty = { actual: 0, baseline: 0, residual: 0, wastePercentile: 0, isZero: 0 };
        const axes = Object.fromEntries(
          ALL_AXES.map((k) => [k, toAxisScore(byAxis.get(k) ?? empty)]),
        ) as Record<EfficioAxisKey, EfficioAxisScore>;
        return {
          sessionId: u.sessionId,
          title: u.title,
          project: u.project,
          tsFirst: u.tsFirst,
          turns: u.turns,
          totalTokens: u.totalTokens,
          axes,
        };
      });
      sessions.reverse(); // 과거→현재(차트 좌→우)
      return { modelVersion: model.v, sessions };
    } catch {
      return { modelVersion: null, sessions: [] };
    } finally {
      db.close();
    }
  }

  return { dbPath, status, timeline, profiles };
}

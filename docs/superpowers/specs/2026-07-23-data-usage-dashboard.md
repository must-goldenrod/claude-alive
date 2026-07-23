# LLM 사용량 데이터 대시보드 (도구 > 데이터) / LLM Usage Data Dashboard

- 작성일 / Date: 2026-07-23
- 상태 / Status: 구현 완료 (implemented)
- 관련 뷰 / View id: `data` (그룹 `tools`)

## 1. 목표 / Goal

상단 메뉴 **도구(Tools) > 데이터(Data)** 에 새 뷰를 추가한다. 세션과 티켓을 통해 발생한
LLM 관련 정보(토큰 사용량, 모델별 사용량, 콜 횟수, 비용)를 한곳에 모아 정리·출력하고,
**일 / 주 / 월 합계**와 그래프로 확인할 수 있게 한다.

Add a new **Tools > Data** view that consolidates all LLM usage produced by
sessions and tickets — token usage, per-model usage, call counts, cost — and
surfaces **daily / weekly / monthly totals** plus graphs.

## 2. 데이터 소스 (기존 수집분 재사용) / Data sources (reuse existing)

새 수집 파이프라인은 만들지 않는다. 데이터는 이미 두 곳에 영속화되어 있다.
No new collection pipeline. Data already persists in two places.

| 소스 | 엔드포인트 | 제공 필드 |
|---|---|---|
| 티켓 메인 에이전트 | `GET /api/tickets` → `{ tickets: Ticket[] }` | `model`, `usage`(input/output/cacheRead/cacheCreation/total tokens, `costUsd`, `numTurns`), `delegations[]`, `endedAt`/`startedAt`/`createdAt` |
| 티켓 서브에이전트 위임 | (동일 티켓의 `delegations[]`) | `model`, tokens, `costUsd`, `at` |
| 종료 세션 | `GET /api/completed?limit=…` → `{ sessions: CompletedSession[] }` | `tokenUsage`(tokens, `apiCalls`, `model`), `completedAt` |

- 비용(cost)은 **티켓/위임에만** 존재한다. 종료 세션은 비용 없음(0으로 취급).
- 콜 횟수(calls)는 세션 `apiCalls`, 티켓 `numTurns`(없으면 1), 위임 1로 정규화.
- 모델명이 없으면 `unknown`.

## 3. 아키텍처 / Architecture

빌드 안정성상 집계 로직은 **UI 패키지 내부**의 순수 함수로 둔다(core 런타임 값 import 시
readline 유입으로 브라우저 빌드가 깨지는 기존 이슈 회피 — core에서는 `import type`만 사용).
서버 신규 엔드포인트 없이 클라이언트에서 기존 두 API를 합산한다.

```
/api/tickets  ─┐
               ├─► usageAggregation.ts (순수 함수) ─► DataView.tsx (표 + SVG/CSS 막대그래프)
/api/completed ─┘
```

### 3.1 집계 모듈 `packages/ui/src/views/data/usageAggregation.ts`

- 세 소스를 공통 `UsageRecord`(at, model, tokens, cost, calls)로 정규화.
- 산출 `UsageSummary`:
  - `total` — 전체 합계
  - `byModel[]` — 모델별 합계, totalTokens 내림차순
  - `byDay[] / byWeek[] / byMonth[]` — 기간 버킷(오름차순), 그래프용
  - `today / thisWeek / thisMonth` — `now` 기준 당일/이번 주(월요일 시작)/이번 달 합계
  - `recordCount`, `modelCount`, `firstAt`/`lastAt`
- 시간 버킷: `startOfDay`(local), `startOfWeek`(월요일), `startOfMonth`.

### 3.2 뷰 `packages/ui/src/views/data/DataView.tsx`

- 상단 stat 타일: 전체 토큰 / 비용 / 콜 수 / 모델 수 (+ 당일·주·월 합계 타일).
- 시계열 막대그래프: 일/주/월 토글, 총 토큰 막대(단일 accent 색 = magnitude, 범례 없음, hover 툴팁).
- 모델별 표: model · input · output · cache · total · cost · calls · 점유율 막대.
- 새로고침 버튼, 서버 unreachable/빈 상태 처리, 전 텍스트 i18n.

### 3.3 통합 지점 / Wiring

- `App.tsx`: `ViewMode`에 `'data'` 추가, lazy import + 렌더 분기, ChatOverlay `contentViewActive`에 포함.
- `viewGroups.ts`: `{ mode: 'data', labelKey: 'viewMode.data', group: 'tools' }`.
- i18n `en/ko.json`: `viewMode.data` + `data.*` 키.

## 4. 시각화 규칙 (dataviz) / Visualization rules

- 단일 측정(토큰/비용)은 **단일 accent 색**(magnitude). 모델 식별은 표 중심, 색 순환 금지.
- 얇은 막대 + 4px 둥근 끝 + baseline 고정, 막대 사이 2px 간격, hover 툴팁.
- 라벨·수치는 텍스트 토큰(`--text-*`) 사용, 막대 색과 분리. 단일 시리즈는 범례 없음.
- 이중축 금지. 토큰과 비용은 별개 차트/열.

## 5. 테스트 / Tests

- `packages/ui/src/__tests__/usageAggregation.test.ts` (vitest, 순수 함수):
  - 세 소스 정규화·합산, totalTokens 파생, cache 합산.
  - 일/주/월 버킷 경계, today/thisWeek/thisMonth 산출.
  - 빈 입력 → 0 합계, 모델명 누락 → `unknown`.

## 6. 범위 밖 / Out of scope

- 서버측 집계 엔드포인트/영속 집계 테이블(추후 데이터량 증가 시 고려).
- 차트 라이브러리(recharts 등) 도입 — 의존성 없이 CSS/SVG 막대로 구현.
- 실시간 스트리밍 갱신 — 진입/새로고침 시 fetch.

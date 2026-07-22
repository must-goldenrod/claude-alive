# 평가·품질 피드백 루프 (Evaluation Feedback Loop) — 설계

- **날짜**: 2026-07-22
- **브랜치**: `feat/ticket-centric-restructure`
- **범위**: 전체 비전의 하위 프로젝트 **C**. A안(IA 재편) 완료 후 진행.

## 1. 배경 / 목표

사용자 비전: 티켓 작업을 시퀀셜하게 다루면서 LLM의 수행 과정·결과를 **good/bad로 평가**하고, 그 가중치를 반영해 LLM이 다음 작업 시 **학습된 가이드를 따르게** 한다. 이를 통해 티켓 완료 확률을 높이고 지속적 품질관리를 한다. 기록 대상: **루트-세션-프롬프트-수행과정-결과-평가**. 이를 데이터셋화하고 **oneshot**(한 번 빠르게 학습해 결과에 반영) classification으로 결과를 향상.

**이번 C안이 닫는 루프:**
```
티켓 종료(done/failed)
  → 평가 기록 생성 (route·session·goal·result·verdict 캡처, autoLabel 시드)
  → 사람이 good/bad 라벨 + 가중치 부여
  → route(프로젝트)별 가이드 합성 (oneshot: 최강 good 예시 + bad 안티패턴)
  → 다음 티켓 실행 시 메인 프롬프트에 가이드 prepend
  → 완료 확률↑
```

**비목표(이번 범위 밖):** 별도 ML 모델 학습, 임베딩/벡터 검색, efficio Python 파이프라인 통합, 전체 수행과정(tool call) 원문 재수집(이미 canonical event log에 있음 — 조인만 남겨둠).

## 2. 데이터 모델 (core 신규)

`packages/core/src/tickets/evaluation.ts`:

```ts
export type EvalLabel = 'good' | 'bad' | 'unrated';

export interface TicketEvaluation {
  ticketId: string;
  seq: number;
  route: string;              // = ticket.cwd (프로젝트 루트). 가이드 그룹 키.
  goal: string;
  claudeSessionId?: string;   // 세션 이벤트 로그 조인 키
  model?: string;
  headline?: string;
  verdictPassed?: boolean;    // ticket.verification.passed
  failureReason?: TicketFailureReason;
  autoLabel: EvalLabel;       // verification에서 자동 시드된 잠정 라벨
  label: EvalLabel;           // 사람 라벨(없으면 autoLabel 사용). 실제 신호.
  weight: number;             // 1..5 영향 가중치, 기본 3
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RouteGuide {
  route: string;
  text: string;               // 프롬프트에 주입되는 합성 가이드(빈 문자열이면 미주입)
  goodCount: number;
  badCount: number;
  updatedAt: number;
}
```

`autoLabel` 시드 규칙: `done` + `verification.passed===true` → `good`; `failed` → `bad`; 그 외 → `unrated`. 사람이 `label`을 명시하면 그것이 우선.

## 3. 저장 (server 신규, ticketStore 패턴 미러)

`packages/server/src/evalStore.ts` — `createEvalStore({ file?, max? })`, 파일 기반 JSON(`~/.claude-alive/evaluations.json`), in-memory `Map`, serialized flush, cap. ticketStore.ts와 동일 구조.

API:
- `load()` / `list()` / `get(ticketId)`
- `upsertFromTicket(ticket)` — 티켓 종료 시 기록 생성/갱신. autoLabel 시드. 기존 사람 라벨 보존.
- `setLabel(ticketId, { label, weight?, note? })` — 사람 평가 반영.
- `guideFor(route)` — 해당 route의 `RouteGuide` 반환(합성).

## 4. 가이드 합성 (oneshot, 결정론적)

`packages/server/src/guideSynthesizer.ts` — `synthesizeGuide(route, evals): RouteGuide`.

- 입력: 해당 route의 평가 기록들.
- good(라벨=good) → weight 내림차순 상위 N=2를 **긍정 예시**(goal → headline)로.
- bad(라벨=bad) → 최근 N=2를 **안티패턴**(goal → failureReason/note)로.
- 출력 텍스트(중립 서술, 길이 캡 ~800자):
  ```
  [이 프로젝트에서 학습된 작업 가이드]
  잘된 사례(따를 것):
   - <goal> → <headline>
  피해야 할 사례:
   - <goal> → <failureReason/note>
  ```
- good/bad 없으면 `text=''`(주입 안 함).

"oneshot" = 별도 모델 없이 최강 예시 1~2개를 즉시 프롬프트에 반영.

## 5. 프롬프트 주입 (server)

`index.ts`의 `spawnMain` 클로저를 `buildMainPrompt(ticket, guide)` 헬퍼로 리팩터.

```ts
function buildMainPrompt(goal: string, guideText: string): string {
  const head = guideText ? `${guideText}\n\n---\n` : '';
  return `${head}${goal}\n\n---\n작업을 마친 뒤 … HEADLINE: <핵심 결과 한 줄>`;
}
// spawnMain: guide = evalStore.guideFor(ticket.cwd); goal: buildMainPrompt(ticket.goal, guide.text)
```

주입은 **실행 시점**에 route의 현재 가이드를 읽음 → 라벨이 바뀌면 다음 티켓부터 자동 반영.

## 6. 배선 (server)

- 티켓 종료 훅: `createTicketRunner`에 `onSettled?(ticket)` 옵션 추가, `done`/`failed` 전이에서 호출. `index.ts`에서 `onSettled: (t) => { evalStore.upsertFromTicket(t); broadcast eval; }` 연결.
- HTTP: `POST /api/tickets/:id/evaluate` (loopback-only) body `{ label, weight?, note? }` → `evalStore.setLabel` → `evaluation:update` 브로드캐스트. `GET /api/evaluations` → 목록.
- 스키마 검증: Zod `EvaluateBodySchema`(label enum, weight 1..5 int, note ≤ 2000).

## 7. 프로토콜 (core)

`wsProtocol.ts` `WSServerMessage`에 추가:
```ts
| { type: 'evaluation:update'; evaluation: TicketEvaluation }
```
(guide는 UI에 필수 아님 — 주입은 서버측. 필요 시 후속.)

## 8. UI

`TicketDetailModal`에 "평가" 섹션 추가:
- Good / Bad 토글 버튼 + 가중치(1~5) + 메모(선택) → `POST /evaluate`.
- 현재 autoLabel/label 표시.
- 종료(done/failed) 티켓에서만 노출.

`useTickets`(또는 신규 `useEvaluations`)에서 `evaluation:update` 구독 + `evaluate()` mutation. UI는 최소 범위 — 별도 분석 뷰는 후속(도구 그룹에 추가 가능).

i18n(ko/en): `tickets.evaluate`, `tickets.evalGood`, `tickets.evalBad`, `tickets.evalWeight`, `tickets.evalNote`, `tickets.evalSaved`, `tickets.evalAuto`.

## 9. 오류 처리 / 엣지

- `evaluations.json` 파손: load 시 무시하고 빈 상태로 시작(ticketStore와 동일).
- 티켓 삭제 시 평가 기록: 남겨둠(데이터셋 보존). 후속에서 정리 옵션.
- 가이드 길이 폭주: 캡으로 방지.
- route에 good/bad 하나도 없으면 주입 없음(기존 동작과 동일 — 회귀 없음).

## 10. 테스트

- **core**: autoLabel 시드 규칙(done+passed→good, failed→bad, 그 외 unrated).
- **server**: `evalStore` upsert가 사람 라벨 보존; `setLabel` 반영; `synthesizeGuide`가 good→긍정/bad→안티패턴 배치, 빈 입력→빈 텍스트, 길이 캡; `buildMainPrompt`가 가이드 있을 때만 prepend.
- **회귀**: 기존 UI 108 테스트 + 서버 테스트 유지, tsc 클린, 빌드 성공.

## 11. 구현 단계 (각 단계 후 tsc/test → 커밋)

1. **C1** core: `evaluation.ts` 타입 + autoLabel 시드 함수 + 단위 테스트.
2. **C2** server: `evalStore.ts`(+테스트), `guideSynthesizer.ts`(+테스트), `buildMainPrompt`(+테스트).
3. **C3** server 배선: `onSettled` 훅, HTTP `/evaluate`·`/evaluations`, 프롬프트 주입, WS 브로드캐스트.
4. **C4** protocol+UI: `evaluation:update` 메시지, TicketDetailModal 평가 섹션, useTickets 배선, i18n.
5. **C5** 전체 검증(tsc+test+build) → 최종 커밋.

가역적(기존 티켓 동작은 가이드 빈 문자열이면 그대로) → 롤백 안전.

# ADR-0002: canonical event로 정규화하되 공급자 원본을 보존한다

- 상태: **Accepted** (P0 fixture review)
- 일자: 2026-07-20

## 맥락
공급자마다 이벤트 어휘가 다르다. 공통 모델 없이는 한 화면에 모을 수 없지만, 공통 모델로 평탄화하면 원본 의미가 소실되어 잘못된 상태 표시와 비교로 이어진다.

## 결정
모든 입력을 `CanonicalEvent`(schemaVersion 2) 봉투로 정규화한다. 봉투는 정규화 결과와 함께 출처를 항상 동반한다: `source`(structured/hook/transcript/pty/synthetic), `confidence`(exact/derived/heuristic), `sourceEventId`, `rawRef`. 공급자 원본 상태 문자열은 `NormalizedState.providerState`에 그대로 보존한다.

## 근거
- 추론으로 얻은 상태와 구조화 이벤트로 얻은 상태를 같은 신뢰도로 취급하면 UI가 거짓을 사실처럼 표시한다.
- P0 동등성 테스트에서 실제로 발생했다: v2 상태 파생이 legacy FSM과 달라 `Stop`을 `completed`로 잘못 표시했다. 공급자 의미론을 공급자 계층이 소유하도록 바꿔 해결했다(`claudeSessionReducer.ts`).

## 결과
- 구현: `packages/core/src/canonical/events.ts`, `stateMapping.ts`, `claudeSessionReducer.ts`
- 검증: `packages/storage/src/__tests__/v1v2Parity.test.ts` (동일 hook 시퀀스 → legacy/v2 결과 일치)
- 모호한 hook은 억지 매핑 대신 미매핑으로 둔다(TaskCompleted, Worktree*).

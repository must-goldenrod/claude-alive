# ADR-0001: Alive는 thin orchestration/control plane이다

- 상태: **Accepted** (P0 contract review)
- 일자: 2026-07-20

## 맥락
Claude/Codex/Hermes는 각자 추론, 도구 호출, MCP 연결, 권한 처리, 세션 관리를 이미 구현하고 있다. Alive가 이를 재구현하면 공급자 변경마다 깨지고, 승인·보안 경계를 스스로 떠안게 된다.

## 결정
Alive는 공급자의 두뇌를 대체하지 않는다. 관찰(Observe) → 개입(Intervene) → 복원(Resume) → 검토(Review)만 책임진다. 계획·추론은 공급자 에이전트에 맡기고, Alive는 명시적인 세션 작업(시작·입력·중단·재개·승인 전달)만 조율한다.

## 근거
- 공급자 프로토콜은 독립적으로 변한다. 얇은 경계일수록 파손 면적이 작다.
- 승인·비밀 처리를 대신하면 보안 책임이 Alive로 이전된다 (→ ADR-0006, ADR-0009).

## 결과
- 중앙 LLM router, 임의 계획 그래프 생성기, 공급자 간 기억 자동 복제는 비목표다.
- 어댑터는 `AgentRuntimeAdapter`(`packages/core/src/canonical/adapter.ts`)만 구현하면 된다.
- 대가: 공급자가 제공하지 않는 기능은 Alive도 제공할 수 없다. capability로 명시한다 (→ ADR-0007).

# ADR-0007: UI는 공급자 이름이 아니라 capability로 분기한다

- 상태: **Accepted** (P0 adapter contract)
- 일자: 2026-07-20

## 맥락
공급자마다 지원 기능이 다르다(중단, 승인, 토큰 집계, 재개, 서브에이전트). `if (provider === 'claude')` 분기를 쓰면 새 공급자마다 UI 전체를 수정해야 하고, 같은 공급자의 버전 차이를 표현할 수 없다.

## 결정
`ProviderCapabilities`(`core/canonical/capabilities.ts`)가 UI 어포던스를 결정한다. 어댑터가 `capabilities()`로 선언하고, UI는 그 값만 본다. 공급자 이름 분기는 금지한다.

## 근거
- 새 공급자는 어댑터와 capability만 추가하면 기존 UI에 들어온다.
- 선언과 구현이 어긋나면 계약 위반이므로 자동 검증한다.

## 결과
- conformance harness가 **capability↔method presence**를 검사한다: `interrupt: true`인데 `interrupt()` 메서드가 없으면 탈락 (`core/canonical/conformance.ts`).
- 미지원 기능은 숨기지 않고 비활성 상태와 이유를 표시한다(§C.7 graceful degradation).

# ADR-0006: 공급자 native MCP 설정을 우선하고, 중앙 proxy는 후속 opt-in

- 상태: **Accepted** (P0 security review)
- 일자: 2026-07-20

## 맥락
MCP는 Host가 여러 Client를 관리하고 capability negotiation으로 Server 기능을 확인하는 구조다. Alive가 모든 런타임 대신 MCP Host가 되면 인증, sampling, elicitation, tool approval, 프로토콜 버전 호환을 전부 떠안는다.

## 결정
Claude/Codex/Hermes가 가진 native MCP 설정과 인증을 그대로 사용한다. Alive는 MCP 서버의 이름, transport, 연결 상태, capability, 인증 필요 여부를 **표시만** 한다. 공용 MCP proxy는 사용자가 명시적으로 선택한 경우에만 제공하는 후속 기능이다.

## 근거
- Host가 되면 ADR-0001의 thin orchestration 원칙과 충돌한다.
- 비밀 복사 없이 표시만 하면 유출 표면이 늘지 않는다(→ ADR-0009).

## 결과
- 프로젝트 템플릿은 공급자별 설정 변환을 제공하되 실제 비밀은 복사하지 않는다.
- 신뢰되지 않은 MCP 응답은 에이전트 입력 표면이므로 권한·sandbox 경계를 유지한다.

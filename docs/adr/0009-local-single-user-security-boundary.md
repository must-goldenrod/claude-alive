# ADR-0009: MVP의 보안 경계는 로컬 단일 사용자다

- 상태: **Accepted** (P0 threat model)
- 일자: 2026-07-20

## 맥락
Alive는 터미널 출력, 프롬프트 원문, 코드 경로, 세션 이력을 다룬다. 이는 그대로 유출 표면이다. 원격 접속을 기능으로 열면 인증·소유권·감사가 즉시 필요해진다.

## 결정
MVP는 로컬 단일 사용자 앱이다. 서버는 기본 `127.0.0.1` bind. LAN 공개는 명시적 설정이며, 그 경우 bearer session + TLS reverse proxy를 필수로 한다. 단순히 `0.0.0.0`으로 bind하는 것은 제품 기능으로 인정하지 않는다.

## 결정 세부
- HTTP Origin 검증, WebSocket origin 검증, CSRF 방어
- API key/OAuth token을 Alive DB·로그·이벤트 payload에 저장하지 않음
- 공급자 app-server/gateway는 가능한 stdio 자식 프로세스로 붙여 외부 포트를 열지 않음
- 터미널 출력·transcript의 secret 필터는 **저장 전·표시 전 2단계**
- 공급자 native approval을 그대로 전달하고 Alive가 임의 승인하지 않음

## 근거
- 원격·팀 기능은 RBAC·비밀 격리·감사 로그가 준비된 뒤에야 안전하다.

## 결과
- 구현된 것: secret redaction (`core/canonical/title.ts`의 `redactSecrets`, 세션 제목·프리뷰에 적용)
- 미구현: Origin/CSRF 검증 강화, 터미널 출력 단계 필터, 세션 데이터 export/삭제 UI → P1 이후

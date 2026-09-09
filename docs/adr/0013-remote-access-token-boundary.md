# ADR-0013: 원격 접근의 경계는 토큰이다 — loopback 이 아니라

- 상태: **Accepted** (실측 + 구현 + 테스트)
- 일자: 2026-09-09
- 관계: [ADR-0009](0009-local-single-user-security-boundary.md)의 "LAN 공개 시 TLS reverse proxy 필수" 항목을 supersede 한다. 나머지 항목(비밀 격리, 감사, native approval)은 그대로 유효하다.

## 맥락

ADR-0009는 로컬 단일 사용자를 경계로 삼고, 서버는 `127.0.0.1` bind, LAN 공개는 bearer session + TLS reverse proxy 필수로 정했다. 2026-09-09 실측 결과 코드는 그 결정과 어긋나 있었다: `listen(PORT)` 에 host 인자가 없어 전 인터페이스에 바인딩되었고, 읽기 API·WebSocket 이 인증 없이 LAN 에 응답했다. WebSocket 은 Origin 만 검사했는데 Origin 미전송(네이티브 클라이언트)은 통과했고, 그 소켓은 `terminal:spawn` 을 받는다.

앱에서 같은 네트워크 밖으로 티켓을 만들고 구동하려면 이 경계를 다시 세워야 한다. 그런데 "loopback 이면 신뢰"라는 기존 판정은 원격 기능과 함께 쓸 수 없다. 실측으로 확인했다 — LAN IP 에 바인딩한 포워더를 `127.0.0.1:3141` 로 붙이면 `/api/tickets`·`/api/git/branches`·`/api/usage` 가 200 을 돌려준다. `ssh -L`, `cloudflared`, 리버스 프록시가 모두 같은 형태다. 즉 loopback 은 터널 한 겹으로 위조된다.

## 결정

1. 기본 바인딩은 `127.0.0.1`. 다른 인터페이스는 `CLAUDE_ALIVE_REMOTE=1` 로만 열리고, 토큰과 `CLAUDE_ALIVE_TICKET_ROOTS` 가 없으면 **부팅을 거부**한다(경고가 아니라).
2. 원격 모드에서 **소스 주소는 증거가 아니다.** loopback 을 포함해 모든 요청이 bearer 토큰을 제시한다. 프록시가 앞에 없는 설치는 `CLAUDE_ALIVE_TRUST_LOOPBACK=1` 로 예전 동작을 되살릴 수 있으나 기본은 꺼짐.
3. 원격 허용 라우트는 **화이트리스트**다. 목록에 없는 라우트는 나중에 추가된 것을 포함해 403. (이전 구조는 반대였다 — 새 라우트가 기본 노출.)
4. 게이트는 prompt-agent 위임보다 **앞**에 둔다. 뒤에 두면 `/api/prompts`·`/api/sessions`·`/v1/ingest/*` 가 정책 밖으로 빠진다.
5. WebSocket 도 같은 토큰을 요구한다. 기기 연결은 읽기 전용이며 `terminal:*` 는 거부한다.
6. 로컬 구성요소(훅 스크립트·CLI·서버가 서빙하는 대시보드)는 `~/.claude-alive/.env`(0600)에 생성되는 **전권 로컬 토큰**을 쓴다. 로컬임을 증명하는 것은 소스 주소가 아니라 그 파일을 읽을 수 있다는 사실이다.
7. **전송 암호화는 서버가 떠안지 않는다.** Tailscale/WireGuard 같은 사설망 또는 TLS 종단 터널에 위임한다. (ADR-0009의 "TLS reverse proxy 필수"를 이 항목이 대체한다.)

## 근거

- 인증서 갱신은 로컬 데몬의 영구 부채다. 반면 WireGuard 계열 망은 암호화와 기기 인증을 동시에 끝낸다.
- 화이트리스트를 택한 이유는 실패 방향이다. 블랙리스트는 새 라우트가 노출된 채 시작하고, 그 사실은 아무도 보고하지 않는다.
- 전권 토큰을 파일에 두는 이유: 터널은 주소를 위조할 수 있어도 사용자 홈의 0600 파일을 읽지는 못한다.

## 결과

- 구현: `packages/server/src/remoteAccess.ts`, `wsAuth.ts`, `localToken.ts`, `httpRouter.ts` 게이트, `packages/ui/src/lib/auth.ts`, `claude-alive token`, 훅 스크립트 인증.
- 테스트: 정책 단위 테스트 + 라우터/WS 통합 테스트. 원격 모드에서 loopback 요청도 401 이 되는지를 회귀로 고정했다.
- 미해결: 원격 상태변경 감사 로그(§4.7 설계만 있음), 앱 푸시 알림, 토큰 만료(현재는 폐기만).

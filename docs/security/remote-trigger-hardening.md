# 원격 트리거 보안 설계 및 점검 / Remote Trigger Hardening

상태: rev3(구현 완료·실측 검증) · 작성 2026-09-09 · 대상 버전 0.2.x
목표: 앱에서 로컬 claude-alive를 **같은 네트워크 밖에서** 제어(티켓 생성/트리거)하되, 오픈소스 배포물로서 안전한 기본값과 인증을 갖춘다.
관련 결정: [ADR-0013 원격 접근 경계 = 토큰](../adr/0013-remote-access-token-boundary.md) (ADR-0009 일부 supersede) — §9 참조.
구현 결과와 수정 후 실측은 §10.

---

## 0. 요약 (TL;DR)

- **원격 기능을 붙이기 전에, 지금 배포물이 이미 LAN에 열려 있다.** 서버가 `0.0.0.0`에 바인딩되고 다수의 읽기 API·WebSocket이 인증 없이 응답한다.
- **가장 심각한 것은 티켓 API(403)가 아니라 WebSocket이다.** WS에는 loopback 게이트가 없고 Origin만 검사하는데, Origin 미전송(네이티브 클라이언트)은 통과한다. 통과하면 `terminal:spawn`으로 셸/claude PTY를 띄울 수 있다 = 원격 RCE.
- **loopback 게이트는 프록시 한 겹이면 전부 무력화된다.** `req.socket.remoteAddress`만 보므로 `ssh -L`·Cloudflare Tunnel·리버스 프록시를 거친 원격 요청은 `127.0.0.1`로 보인다. §5가 권장하던 전송수단이 §4의 화이트리스트를 무효화한다 (실측 §2.5).
- 원격 트리거의 본질은 "포트 열기"가 아니라 **"loopback이라는 암묵적 인증을 명시적 인증으로 대체"**하는 것.
- **서버 하드닝은 목표의 절반이다.** 앱 측(토큰 보관·Bearer 부착·호스트 지정·WS 인증)과 도달성(절전·동적 IP·알림)이 §7·§8에 있어야 "앱에서 원격 조종"이 성립한다.
- 방향: ① 기본 바인딩을 loopback으로 되돌린다(현재 회귀 상태) → ② 노출은 opt-in + 토큰 강제 → ③ 원격 허용 라우트 화이트리스트 → ④ WS도 동일 토큰 → ⑤ 전송 암호화는 VPN/터널에 위임.

---

## 1. 위협 모델

| 자산 | 노출 시 피해 |
|---|---|
| 티켓 실행(임의 cwd에서 자율 에이전트) | 임의 코드 실행 (RCE 동급). 코드 주석에도 "RCE-equivalent" 명시 |
| WS `terminal:spawn` | 원격 셸/claude PTY = RCE. `initialCommand`가 있어 **메시지 1개로 임의 명령 실행** (index.ts:869~) |
| 세션·프롬프트 전문(`/api/prompts`, `/api/claude/sessions`) | 대화·코드 내용 유출 |
| 파일시스템 열람(`/api/fs/browse`) | 홈 디렉터리 구조 정찰 |
| git 체크아웃/브랜치 삭제 | 작업 트리 변조 |
| 이벤트 주입(`POST /api/event`, `/v1/ingest/web`) | 대시보드·프롬프트 저장소 오염, 가짜 에이전트 |

공격자 등급:
- **A. 동일 LAN**(카페·공유 와이파이): 현재 실질 위협. IP만 알면 도달.
- **B. 브라우저 CSRF/DNS rebinding**: 사용자가 악성 페이지 방문 시 로컬 서버 조작 시도.
- **C. 공개 인터넷**: 사용자가 포트포워딩/터널을 잘못 열면 노출.

---

## 2. 현재 상태 점검 결과 (실측 2026-09-09)

측정: 실행 중 서버(PID 71842, `*:3141` 바인딩). 동일 호스트의 **LAN IP(192.168.100.56)**로 요청 → 원격 클라이언트를 재현.

### 2.1 바인딩
- `httpServer.listen(PORT)` — host 인자 없음(`index.ts:1040`). Node 기본값은 미지정 시 전 인터페이스. `lsof`로 `node ... TCP *:3141 (LISTEN)` 확인.
- **매우 중요**: SECURITY.md는 "Server binds to `localhost` only"라고 명시하나 실제 코드는 그렇지 않다. README.md:574("everything runs locally")도 같다. 문서-코드 불일치이자 ADR-0009 위반.

### 2.2 HTTP 라우트별 LAN 접근 결과

인증 없이 **성공(200)** — 원격 노출됨:

| 라우트 | 내용 | 등급 |
|---|---|---|
| `GET /health` | 헬스체크 | 낮음 |
| `GET /api/status`, `/api/agents` | 에이전트 상태·현재 툴 | 중 |
| `GET /api/events`, `/api/stats` | 이벤트 로그, 통계 | 중 |
| `GET /api/completed`, `/api/sessions` | 세션 목록·cwd·프로젝트명 | 중 |
| `GET /api/v2/workspace-tree` | 워크스페이스 트리(경로 포함) | 중 |
| `GET /api/fs/browse?dir=/` | **임의 디렉터리 열람** | 높음 |
| `GET /api/claude/sessions?cwd=…` | 과거 Claude 세션 | 높음 |
| `GET /api/prompts`, `/api/efficio/profiles` | **프롬프트 전문·세션 제목** | 높음 |
| `PUT /api/projects/names` | **쓰기 성공(200)** — 프로젝트명 변조 | 중 |
| `POST /api/event` | 게이트 없음. 잘못된 JSON에 400 = 핸들러 도달 → **훅 이벤트 위조** | 중 |
| `PUT /api/agents/:id/name` | 게이트 없음. 없는 id에 404 = 핸들러 도달 → **에이전트 개명** | 중 |
| `DELETE /api/agents/:id` | 게이트 없음. 없는 id에 404 = 핸들러 도달 → **에이전트 삭제** | 중 |
| `POST /v1/ingest/web` + `X-Think-Prompt-Ext: 1` | **200. 프롬프트 저장소 원격 쓰기** | 높음 |

**loopback 차단(403)** — 정상:
`/api/usage`, `/api/tickets`, `/api/runs`, `/api/git/*`, `/api/backends`, `/api/evaluations`.

**정정(rev2)**: `POST /v1/ingest/web`의 403은 loopback 게이트가 아니라 prompt-agent의 헤더 소프트인증(`server.ts:303~309`)이었다. 헤더 한 줄을 붙이면 LAN에서 200이 나온다. rev1의 "loopback 차단" 분류는 오류다.

### 2.3 WebSocket (`/ws`)
- Origin **미전송** → `OPEN`. 즉시 `snapshot`/`run:snapshot`/`ticket:snapshot`/`system:usage`/`v2:catalog-changed`/`system:metrics` 수신(모든 세션 데이터).
- Origin `http://192.168.100.56:3141`(원격 호스트) → 소켓 종료. Origin 검사(`wsOrigin.ts`)는 loopback 호스트명만 허용.
- **매우 중요**: WS에는 `isLoopbackRequest` 게이트가 없다. `wsClientSchema`에 `terminal:spawn`(mode `shell`/`claude`, `initialCommand`, `skipPermissions`)이 있고 핸들러(index.ts:869)에도 어떤 인증 검사가 없다. Origin을 보내지 않는 네이티브 클라이언트는 LAN에서 붙어 **원격 PTY 스폰·임의 명령 실행**이 가능하다. 티켓 API 403보다 심각하다.

### 2.4 근거 파일
- 바인딩: `packages/server/src/index.ts:1040`
- HTTP loopback 게이트: `packages/server/src/httpRouter.ts:263`(`isLoopbackRequest`), 라우트별 적용 `:477 :499 :612 :622 :634 :674 :695 :728`
- 게이트 없는 라우트: `httpRouter.ts:379 :394 :432 :442 :450 :468 :704 :710 :716 :742 :762 :792 :808~826`
- prompt-agent 위임(메인 게이트 앞): `httpRouter.ts:357~371` → `packages/prompt-agent/src/server.ts:417`(`/api/prompts`), `:516`(`/api/sessions`), `:303`(`/v1/ingest/web` 헤더 검사)
- WS Origin-only: `packages/server/src/wsOrigin.ts`, 업그레이드 훅 `index.ts:949`
- WS 스폰 스키마·핸들러: `wsClientSchema.ts:20`, `index.ts:869`
- ticket-roots 경고만: `index.ts:658`, 로컬 전용 allowlist `index.ts:501` + `executors/resolve.ts`

### 2.5 프록시 한 겹이면 loopback 게이트가 사라진다 (rev2 신규 실측)

`isLoopbackRequest`는 `req.socket.remoteAddress`만 본다. LAN IP에 바인딩한 TCP 포워더를 `127.0.0.1:3141`로 붙이고(= `ssh -L`, `cloudflared`, 리버스 프록시와 동일 형태) LAN에서 요청한 결과:

```
GET /api/tickets       -> 200   (직접 요청 시 403)
GET /api/git/branches  -> 200   (직접 요청 시 403)
GET /api/usage         -> 200   (직접 요청 시 403)
```

**매우 중요**: rev1 §5가 권장한 "SSH 로컬 포워딩"과 "Cloudflare Tunnel"이 정확히 이 형태다. 즉 권장 전송수단을 쓰는 순간 §4의 화이트리스트·loopback 구분이 통째로 무효가 된다. 판정식을 `isLoopbackRequest(req) || (remote && token)`로 쓰면 원격 요청이 **첫 항에서 통과**한다.

### 2.6 원격 브라우저/웹뷰 앱은 WS를 못 연다 (rev2 신규)

`isAllowedWsOrigin`은 loopback 호스트명만 허용하므로, 서버가 서빙한 UI를 원격 호스트명으로 열면 업그레이드가 거부된다(§2.3 실측). rev1 §4.4는 "Origin 검사에 더해 토큰 검증"이라고만 적어, **원격 Origin을 허용 목록에 넣는 변경**을 빠뜨렸다. 그대로 구현하면 네이티브 앱(Origin 미전송)만 동작하고 웹/웹뷰 앱은 실시간 스트림을 못 받는다.

---

## 3. 인증·증명 방식 점검 (키를 받거나 증명하는 방법)

| 방식 | 전송암호화 | 브라우저앱 | RCE 위험시 적합성 | 구현비용 | 판정 |
|---|---|---|---|---|---|
| **Bearer 토큰** (`CLAUDE_ALIVE_TOKEN`) | ✗(별도 필요) | O | 단순·명확 | 낮음 | **채택**(1차) |
| HMAC 서명(nonce+ts) | ✗ | △ | 재전송 방어 추가 | 중 | 평문망 노출 시에만 |
| mTLS(클라 인증서) | O | △(설치 번거) | 강함 | 높음 | 과함 |
| Tailscale/WireGuard | O(위임) | O | 기기 인증을 망계층서 종결 | 낮음(외부도구) | **채택**(전송/도달) |
| Cloudflare Tunnel+Access(OIDC) | O | O | SSO까지 | 중 | 공개 브라우저앱 대안 |

설계 결론:
- **인증(누구냐)** = Bearer 토큰. 서버 코드로 검증.
- **전송 암호화(엿보기 방지)** = 서버가 떠안지 않고 **Tailscale/WireGuard에 위임**. 서버 자체 TLS는 인증서 갱신이 영구 부채가 되므로 기본 채택하지 않는다(문서로 안내).
- HMAC은 지금 넣지 않되 토큰 회전이 가능하도록만 설계.

### 3.1 토큰 요구사항
- 생성: 32바이트 CSPRNG(`crypto.randomBytes(32).toString('base64url')`).
- 저장: `~/.claude-alive/.env`(이미 `serverEnv.ts`가 읽음, 신규 로더 불필요). 파일 권한 **0600** 강제·경고.
- 비교: **`crypto.timingSafeEqual`**(길이 선검사 후). 문자열 `===` 금지.
- 전달: HTTP `Authorization: Bearer <token>`. WS는 `Sec-WebSocket-Protocol` 또는 최초 메시지 인증(쿼리스트링은 로그에 남으므로 지양).
  - 구현 주의: `Sec-WebSocket-Protocol`을 쓰면 서버가 **선택된 서브프로토콜을 응답에 되돌려야** 브라우저가 연결을 유지한다.
- 로깅: 토큰 값은 어떤 로그·에러에도 출력 금지. 적용 여부(키 이름)만 로깅.
- 실패: 401 + 고정 지연/레이트리밋(브루트포스 완화).
- **기기별 토큰**: 단일 공유 비밀은 분실 기기만 폐기할 수 없다. 최소한 `CLAUDE_ALIVE_TOKENS`(콤마 구분, 라벨 포함) 형태로 복수 토큰을 받고 라벨 단위로 지울 수 있게 한다.

---

## 4. 설계안 (구현 지침)

원칙: **안전한 기본값(secure by default)**. 아무 설정 없이 실행하면 loopback 전용.

1. **바인딩 기본값 복구**
   - `CLAUDE_ALIVE_HOST` 도입, 기본 `127.0.0.1`. `listen(PORT, HOST)`.
   - 회귀 수정이므로 원격 기능과 무관하게 **선행 단독 커밋** 권장.

2. **노출 opt-in + 토큰 강제**
   - `CLAUDE_ALIVE_REMOTE=1`일 때만 외부 바인딩 허용.
   - 이때 `CLAUDE_ALIVE_TOKEN` 미설정 → **부팅 거부**(경고 아님).
   - `CLAUDE_ALIVE_TICKET_ROOTS` 미설정 → 원격 모드 부팅 거부(현재는 경고만). 단 이 allowlist는 **로컬 티켓에만** 적용된다(`index.ts:501`) — 원격 모드에서 `location.kind === 'ssh'` 티켓은 별도 정책(호스트 allowlist)이 필요하다.

3. **게이트 반전 + 화이트리스트 (rev2 수정)**
   - 판정식(수정): `remoteEnabled ? (validToken(req) && isRemoteAllowed(method, path)) : isLoopbackRequest(req)`.
     - **`isLoopbackRequest`를 OR로 두지 않는다.** §2.5대로 프록시 경유 요청이 loopback으로 보이므로, 원격 모드에서는 소스 주소와 무관하게 토큰을 요구해야 한다.
     - 로컬 UI도 같은 규칙을 타야 하므로, 서버가 서빙하는 UI에 토큰을 주입하거나(부팅 시 생성된 값) 로컬 전용 예외를 `CLAUDE_ALIVE_TRUST_LOOPBACK=1`로 **명시 opt-in** 시킨다.
   - **기본은 원격 불가**. 신규 라우트는 명시적으로 화이트리스트에 넣기 전엔 원격 차단(현재는 반대 = 새 라우트가 기본 노출).
   - 게이트 위치: `httpRouter.ts:357`의 **promptRouter 위임보다 앞**. 뒤에 두면 `/api/prompts`·`/api/sessions`·`/v1/ingest/`가 통째로 우회한다(§2.4).
   - 원격 허용 후보(최소): `POST /api/tickets`(생성), `GET /api/tickets`, `POST /api/tickets/:id/{cancel,retry,reply}`, `GET /api/evaluations`, `GET /api/status`, 정적 UI.
   - **원격 영구 차단**: `terminal:*`(WS), `/api/git/*`(쓰기), `/api/fs/browse`, `/api/ssh/browse`, `PUT /api/projects/names`, `POST /api/event`, `PUT|DELETE /api/agents/*`, `/v1/ingest/*`.
   - **미해결 충돌**: 티켓 생성 UI는 `/api/fs/browse`·`/api/git/branches`·`/api/ssh/browse`에 의존한다(§7.2). 차단만 하면 원격에서 티켓을 만들 수 없다 → 루트 화이트리스트 내부만 반환하는 **원격 전용 프로젝트 목록 엔드포인트**가 필요하다.

4. **WS 인증 (rev2 수정)**
   - 업그레이드 시 토큰 검증 추가. 토큰 없는 원격 업그레이드 거부.
   - Origin 정책도 함께 바꾼다: 원격 모드에서는 **서버 자신의 호스트 Origin을 허용 목록에 추가**해야 웹/웹뷰 앱이 붙는다(§2.6). 그 외 Origin은 계속 거부.
   - 원격 세션은 `terminal:spawn`/`terminal:input` 거부(읽기 스냅샷·티켓 이벤트만 허용). 연결 단위로 `remote` 플래그를 달아 메시지 핸들러에서 판정한다.

5. **전송/도달**
   - 기본 안내: Tailscale(권장) 또는 SSH 로컬 포워딩. 공개 인터넷 직노출은 문서에서 비권장.
   - 브라우저 앱이 필요하면 Cloudflare Tunnel+Access를 대안으로 문서화.
   - **전제**: 어느 쪽을 쓰든 §4.3의 수정된 판정식이 먼저 들어가야 한다. 그렇지 않으면 터널이 인증을 무력화한다.

6. **CSRF/rebinding 방어(브라우저 대비)**
   - 상태변경 라우트는 `Authorization` 헤더 필수(쿠키 인증 금지 → CSRF 자동 완화).
   - `Host` 헤더 화이트리스트 검사(DNS rebinding 완화).

7. **감사 로그**
   - 원격 토큰으로 수행된 상태변경(티켓 생성/취소/재시도/응답)은 시각·라벨·라우트를 남긴다. 토큰 값은 남기지 않는다.

8. **문서 동기화**
   - SECURITY.md의 "localhost only"·"No authentication"과 README.md:574를 실제 동작(기본 loopback, opt-in 원격+토큰)과 일치시킨다.

---

## 5. 점검 체크리스트

### 현황 확인(측정 완료 = [x])
- [x] 서버 바인딩 인터페이스 확인 → `*:3141` (loopback 아님)
- [x] HTTP 라우트별 LAN 접근 코드 수집(200/403)
- [x] `/api/fs/browse` LAN 열람 가능 확인
- [x] `/api/prompts`·`/api/claude/sessions` 프롬프트 전문 LAN 노출 확인
- [x] `PUT /api/projects/names` LAN 쓰기 성공 확인
- [x] `POST /api/event`·`PUT/DELETE /api/agents/*` 게이트 부재 확인(400/404 = 핸들러 도달)
- [x] `/v1/ingest/web`의 403이 헤더 소프트인증임을 확인(헤더 부착 시 LAN 200)
- [x] prompt-agent 3경로가 메인 라우터 게이트 앞에서 위임됨을 확인
- [x] WS Origin-미전송 연결 가능 + snapshot 수신 확인
- [x] WS 원격 Origin 거부 확인(= 원격 웹앱도 못 붙음)
- [x] WS에 loopback 게이트 부재·`terminal:spawn`(+`initialCommand`) 확인
- [x] 로컬 포워더 경유 시 loopback 게이트 무력화 확인(tickets/git/usage 200)
- [x] SECURITY.md·README 문구와 코드 불일치 확인
- [x] loopback 게이트에 대한 기존 테스트 0건 확인(`httpRouter.test.ts`)

### 구현 게이트 — 서버
- [x] `CLAUDE_ALIVE_HOST` 기본 `127.0.0.1` 바인딩 — `index.ts` `listen(PORT, HOST)`
- [x] `CLAUDE_ALIVE_REMOTE` opt-in, 미설정 시 loopback
- [x] 원격 모드에서 토큰 부재 시 부팅 거부
- [x] 원격 모드에서 `CLAUDE_ALIVE_TICKET_ROOTS` 부재 시 부팅 거부 + ssh 호스트 allowlist(`CLAUDE_ALIVE_REMOTE_SSH_HOSTS`)
- [x] `timingSafeEqual` 토큰 검증 + 단위테스트 (`remoteAccess.test.ts`)
- [x] **원격 모드에서 loopback OR 우회 제거** + 포워더 회귀 실측(§10)
- [x] 원격 허용 라우트 화이트리스트(기본 차단), promptRouter 위임 **앞**에 배치 (`remoteGate.test.ts`)
- [x] WS 업그레이드 토큰 검증 + 원격 Origin 허용 + 원격 `terminal:*` 거부 (`wsAuth.test.ts`, `wsRemoteAccess.test.ts`)
- [x] 원격 전용 프로젝트/브랜치 엔드포인트 (`/api/remote/projects`, `/api/remote/branches`)
- [x] 토큰 실패 레이트리밋(1분 10회 → 429)
- [x] 토큰이 로그에 남지 않음 — 실측 0건(§10)
- [x] 로컬 토큰 파일 0600 생성 (`localToken.ts`)
- [ ] 원격 상태변경 감사 로그 — **미착수**

### 구현 게이트 — CLI/앱/문서
- [x] CLI: `claude-alive start --remote/--host`, 부팅 거부 시 로그 노출
- [x] CLI: `claude-alive token new|list|revoke`, `status` 가 로컬 토큰으로 인증
- [x] 훅 스크립트가 0600 env 파일에서 토큰을 읽어 Bearer 전송(재설치 불필요)
- [x] 대시보드: `?token=` 1회 부트스트랩 → localStorage, 동일 출처 요청에 Bearer 자동 부착
- [x] 대시보드: WS 서브프로토콜 인증, 401 시 토큰 입력 오버레이(EN/KO)
- [x] SECURITY.md·README 갱신, ADR-0013
- [ ] 네이티브 앱(별도 저장소): 호스트 입력·키체인 보관·재연결 시 재인증 — 이 저장소 밖
- [ ] `claude-alive doctor` 에 원격 모드 점검 항목 — **미착수**

### 재현 명령 (참고)
```bash
IP=$(ipconfig getifaddr en0)
curl -s "http://$IP:3141/api/fs/browse?dir=/"      # 200 → 노출(수정 후 거부돼야 함)
curl -s "http://$IP:3141/api/prompts" | head -c 80 # 200 → 프롬프트 노출
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -H 'X-Think-Prompt-Ext: 1' -d '{}' "http://$IP:3141/v1/ingest/web"   # 200 → 헤더만으로 원격 쓰기
# 프록시 경유 시 loopback 게이트 무력화: LAN IP에 바인딩한 포워더 → 127.0.0.1:3141
#   node -e "net=require('net');net.createServer(c=>{u=net.connect(3141,'127.0.0.1');c.pipe(u);u.pipe(c)}).listen(3199,'$IP')"
curl -s -o /dev/null -w '%{http_code}\n' "http://$IP:3199/api/tickets"  # 200 (직접 요청은 403)
# WS: Origin 없이 연결되면 snapshot 수신(수정 후 토큰 없이는 거부돼야 함)
```

---

## 6. 우선순위

1. **[P0] 기본 loopback 바인딩** — 원격 기능과 무관, 즉시 회귀 수정. 이것만으로 §2.2/2.3 노출 전부 차단.
2. **[P0] WS loopback/토큰 게이트** — 현재 원격 PTY 스폰 경로 차단.
3. **[P1] 토큰 인증 + 화이트리스트 + opt-in 원격** — 원격 트리거 본기능. §4.3의 **수정된 판정식**과 게이트 배치 위치가 전제.
4. **[P1] 앱 측 구현(§7)** — 이것이 없으면 서버만 잠근 상태로 끝난다.
5. **[P1] 문서 동기화(SECURITY.md/README) + ADR(§9)**.
6. **[P2] CSRF/rebinding 하드닝, 레이트리밋, 토큰 회전, 감사 로그**.

---

## 7. 앱(클라이언트) 측 설계 — rev2 신규

rev1은 서버 하드닝만 다뤘다. 현재 UI에 `Authorization`/토큰 관련 코드는 **0건**이며, `API_BASE`/`WS_URL`은 `window.location` 기반이다(`packages/ui/src/App.tsx:45~46`). 서버가 UI를 서빙하는 한 호스트는 자동으로 맞지만, 인증·원격 전용 흐름은 전부 미구현이다.

### 7.1 형태 선택 (선결 결정)
- **A. 서버가 서빙하는 웹 UI를 원격에서 연다** — 앱 코드 재사용 최대. 전제: WS Origin 확장(§4.4), 토큰을 브라우저에 어떻게 넣을지(URL 1회 교환 후 `localStorage`, 또는 Cloudflare Access가 앞단에서 인증).
- **B. 네이티브 앱이 API만 호출한다** — Origin 문제 없음(미전송), 토큰을 키체인에 보관 가능. UI를 새로 만들어야 함.
- 현재 코드 기준으로는 **B가 마찰이 적다**(WS Origin 거부·CSP·토큰 보관 문제를 모두 피함). 다만 화면을 새로 만드는 비용이 든다.

### 7.2 앱이 실제로 필요한 엔드포인트
티켓 생성 화면이 지금 호출하는 것: `/api/tickets`, `/api/tickets/guide`, `/api/evaluations`, `/api/fs/browse`, `/api/git/branches`, `/api/ssh/browse`.
뒤의 셋은 §4.3에서 원격 차단 대상이다 → **원격에서 티켓을 만들려면 대체 엔드포인트가 있어야 한다**. 최소안: `GET /api/remote/projects` — `CLAUDE_ALIVE_TICKET_ROOTS` 하위의 프로젝트와 각 브랜치 목록만 반환.

### 7.3 최소 구현 범위
- 호스트 입력(예: `http://mac.tailnet.ts.net:3141`) + 연결 테스트(`/health`).
- 토큰 입력·보관. QR 페어링은 선택(서버가 `claude-alive token --qr` 출력).
- 모든 요청에 `Authorization: Bearer`, WS는 §3.1의 방식.
- 티켓: 목록·생성·취소·재시도·**DECISION 응답**(`/reply`).
- 재연결: 네트워크 전환(LTE↔Wi-Fi)·백그라운드 복귀 시 WS 재연결 및 재인증.

---

## 8. 미해결 운영 전제 — rev2 신규

"같은 네트워크가 아닌 상태"에서 실제로 동작하려면 아래가 정해져야 한다. 현재 문서·코드 어디에도 없다.

1. **호스트 절전** — Mac이 잠들면 서버에 도달할 수 없다. `caffeinate`/전원 설정/Power Nap 안내, 또는 항상 켜진 호스트에서 서버를 돌리고 작업만 SSH executor로 내리는 구성(이미 `location.kind === 'ssh'` 지원).
2. **주소 안정성** — 동적 IP/NAT. Tailscale 사용 시 MagicDNS로 해결되지만, 그것이 사실상 필수 의존이 된다는 점을 문서에 명시.
3. **알림** — DECISION 티켓은 사람의 답을 기다리며 멈춘다. 푸시가 없으면 앱을 열어봐야 안다. 최소한 앱 포그라운드 폴링 주기라도 정해야 한다.
4. **토큰 폐기** — 기기 분실 시 개별 폐기(§3.1 기기별 토큰).
5. **버전 스큐** — 앱과 서버 버전 불일치 시 동작. `/health`에 버전 노출 + 앱의 최소 서버 버전 검사.

---

## 9. ADR 관계 — rev2 신규

[ADR-0009](../adr/0009-local-single-user-security-boundary.md)(Accepted, 2026-07-20)는 이미 다음을 결정했다.

> MVP는 로컬 단일 사용자 앱이다. 서버는 기본 `127.0.0.1` bind. LAN 공개는 명시적 설정이며, 그 경우 bearer session + TLS reverse proxy를 필수로 한다. 단순히 `0.0.0.0`으로 bind하는 것은 제품 기능으로 인정하지 않는다.

- 따라서 §2.1의 현재 바인딩은 **새 문제가 아니라 ADR 위반 상태**다. §4.1은 신규 결정이 아니라 원복이다.
- 반면 §3의 "TLS는 Tailscale/WireGuard에 위임, 서버 자체 TLS 미채택"은 ADR-0009의 "TLS reverse proxy 필수"를 **변경**한다. 또 "원격·팀 기능은 RBAC·비밀 격리·감사 로그가 준비된 뒤에야 안전하다"는 근거와도 충돌한다(감사 로그는 §4.7로 편입).
- 필요한 조치: 원격 트리거를 채택하는 **신규 ADR**(0012)로 0009의 해당 항목을 supersede 하거나, 0009에 개정 항을 추가한다. 구현 착수 전에 결정되어야 한다.


---

## 10. 구현 결과와 수정 후 실측 (2026-09-09)

측정 방법: 빌드된 서버를 격리 HOME·포트 3199 로 기동, 같은 LAN IP(192.168.100.56)로 요청. §2 와 동일 조건.

### 10.1 부팅
| 조건 | 결과 |
|---|---|
| 기본(환경변수 없음) | `127.0.0.1:3198` 바인딩. LAN 요청 `000`(도달 불가), loopback `200` |
| `CLAUDE_ALIVE_REMOTE=1`, 토큰 없음 | 부팅 거부 + 사유 출력 |
| `CLAUDE_ALIVE_HOST=0.0.0.0`, remote 아님 | 부팅 거부 + 사유 출력 |
| remote + 토큰 + 루트 | `0.0.0.0:3199`, 토큰 라벨만 로그(값 아님) |

### 10.2 §2.2 에서 열려 있던 라우트 — 토큰 없이 LAN

`/api/status`, `/api/fs/browse`, `/api/prompts`, `/api/sessions`, `PUT /api/projects/names`,
`POST /api/event`, `POST /v1/ingest/web`(+ext 헤더), `DELETE /api/agents/x`, `GET /` — **전부 401**.
(수정 전에는 각각 200.)

### 10.3 기기 토큰

| 라우트 | 결과 |
|---|---|
| `/api/tickets`, `/api/status`, `/api/remote/projects` | 200 |
| `/api/fs/browse`, `/api/prompts`, `/api/event`, `/api/git/branches`, `/` | 403 |
| 티켓 생성 — 루트 밖(`/etc`) | 400 `cwd is not in the ticket-root allowlist` |
| 티켓 생성 — 미허용 ssh 호스트 | 400 `Remote tickets on this host are not allowed…` |
| 티켓 생성 — 루트 안 | 201, 목록에 반영 |

### 10.4 §2.5 프록시 우회 — 재현 결과가 뒤집혔다

같은 포워더(LAN IP → `127.0.0.1:3199`) 경유:

| 요청 | 수정 전 | 수정 후 |
|---|---|---|
| `GET /api/tickets` (토큰 없음) | 200 | **401** |
| `GET /api/git/branches` (토큰 없음) | 200 | **401** |
| `GET /api/usage` (토큰 없음) | 200 | **401** |
| `GET /api/fs/browse` (기기 토큰) | — | **403** |

### 10.5 WebSocket

| 연결 | 결과 |
|---|---|
| 토큰 없음·Origin 없음 (§2.3 의 구멍) | REJECTED |
| 기기 토큰(서브프로토콜/헤더) | CONNECTED, snapshot 수신, `terminal:spawn` **refused** |
| 로컬 토큰 | CONNECTED, `terminal:spawn` 허용(로컬 대시보드용) |
| 잘못된 토큰 | REJECTED |

### 10.6 브루트포스·로그
- 잘못된 토큰 12회: `401×10 → 429×2`. 잠금 창(60초) 동안에는 정상 토큰도 429 — 의도된 동작.
- 서버 로그에서 기기 토큰·로컬 토큰 문자열 **0건**.

### 10.7 구현 후 발견해 고친 것 (브라우저 실측)

1. **원격 모드에서 대시보드가 아예 뜨지 않았다.** `GET /` 를 토큰으로 막으면 `?token=` 로 index.html 은 받아도 `<script src="/assets/…">` 는 헤더를 붙일 수 없어 401 이 된다 — 앱이 부팅되지 않으니 401 시 뜨는 토큰 입력창도 나타날 수 없다. 정적 셸(문서·번들)만 무인증으로 서빙하고 API·WS·`/health` 는 그대로 잠갔다. 셸은 공개된 저장소 코드이며 데이터가 없다.
2. **토큰 입력 후 "사이트를 떠나시겠습니까?"** — App 의 beforeunload 가드가 인증 리로드에도 걸렸다. 인증 리로드만 예외 처리.

브라우저 실측(Playwright, 3195): 셸 로드 → 인증 오버레이 표시 → 로컬 토큰 입력 → 리로드(경고 없음) → 대시보드 렌더 + WS `client connected`. 토큰 이전 WS 는 `rejected upgrade (unauthenticated)` 3회.

### 10.8 원격 터미널 3단계 (2026-09-09 추가)

관전과 조작이 코드상 이미 분리돼 있었다 — `terminal:attach` 는 출력 구독일 뿐이고 타이핑은 `terminal:input` 이다. 그래서 하나의 스위치가 아니라 3단계로 열었다: `CLAUDE_ALIVE_REMOTE_TERMINAL=off|watch|input|shell`, 기본 `off`, 인식 못 하는 값도 `off`.

| 레벨 | 추가되는 것 | 토큰 유출 시 |
|---|---|---|
| off | (티켓만) | 허용 디렉터리에 작업 큐잉 |
| watch | 세션 목록·대화·pty 출력(GET + `terminal:attach`) | 코드·프롬프트 유출 |
| input | `terminal:input`·`terminal:resize` | 이 기계에서 코드 실행 |
| shell | `terminal:spawn`·`terminal:close` | 이 기계의 셸 |

`shell` 로 부팅하면 그 사실과 폐기 방법을 로그에 남긴다. 실측(3188, shell): 폰 크기 브라우저에서 새 터미널 스폰 → `echo`·`pwd`·`whoami` 실행·출력 확인. 소켓 레벨 테스트로 4개 레벨 × 3개 메시지의 허용/거부를 고정했다.

### 10.9 남은 것
1. 원격 상태변경 감사 로그(§4.7) — 미착수.
2. 앱 알림(DECISION 티켓 대기) — 미착수. 현재는 앱이 폴링하거나 WS 를 열어두어야 한다.
3. 토큰 만료 — 폐기(`token revoke`)만 있고 TTL 은 없다.
4. `claude-alive doctor` 원격 점검 항목.
5. 호스트 절전 — 설계상 도달 불가. 문서에만 반영(README).

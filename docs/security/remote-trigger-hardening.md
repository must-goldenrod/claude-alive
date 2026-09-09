# 원격 트리거 보안 설계 및 점검 / Remote Trigger Hardening

상태: 초안(점검 결과 포함) · 작성 2026-09-09 · 대상 버전 0.2.x
목표: 앱에서 로컬 claude-alive를 원격으로 제어(티켓 생성/트리거)하되, 오픈소스 배포물로서 안전한 기본값과 인증을 갖춘다.

---

## 0. 요약 (TL;DR)

- **원격 기능을 붙이기 전에, 지금 배포물이 이미 LAN에 열려 있다.** 서버가 `0.0.0.0`에 바인딩되고 다수의 읽기 API·WebSocket이 인증 없이 응답한다.
- **가장 심각한 것은 티켓 API(403)가 아니라 WebSocket이다.** WS에는 loopback 게이트가 없고 Origin만 검사하는데, Origin 미전송(네이티브 클라이언트)은 통과한다. 통과하면 `terminal:spawn`으로 셸/claude PTY를 띄울 수 있다 = 원격 RCE.
- 원격 트리거의 본질은 "포트 열기"가 아니라 **"loopback이라는 암묵적 인증을 명시적 인증으로 대체"**하는 것.
- 방향: ① 기본 바인딩을 loopback으로 되돌린다(현재 회귀 상태) → ② 노출은 opt-in + 토큰 강제 → ③ 원격 허용 라우트 화이트리스트 → ④ WS도 동일 토큰 → ⑤ 전송 암호화는 VPN/터널에 위임.

---

## 1. 위협 모델

| 자산 | 노출 시 피해 |
|---|---|
| 티켓 실행(임의 cwd에서 자율 에이전트) | 임의 코드 실행 (RCE 동급). 코드 주석에도 "RCE-equivalent" 명시 |
| WS `terminal:spawn` | 원격 셸/claude PTY = RCE |
| 세션·프롬프트 전문(`/api/prompts`, `/api/claude/sessions`) | 대화·코드 내용 유출 |
| 파일시스템 열람(`/api/fs/browse`) | 홈 디렉터리 구조 정찰 |
| git 체크아웃/브랜치 삭제 | 작업 트리 변조 |

공격자 등급:
- **A. 동일 LAN**(카페·공유 와이파이): 현재 실질 위협. IP만 알면 도달.
- **B. 브라우저 CSRF/DNS rebinding**: 사용자가 악성 페이지 방문 시 로컬 서버 조작 시도.
- **C. 공개 인터넷**: 사용자가 포트포워딩/터널을 잘못 열면 노출.

---

## 2. 현재 상태 점검 결과 (실측 2026-09-09)

측정: 실행 중 서버(PID 확인, `*:3141` 바인딩). 다른 기기가 아닌 동일 호스트의 **LAN IP(192.168.100.56)**로 요청 → 원격 클라이언트를 재현.

### 2.1 바인딩
- `httpServer.listen(PORT)` — host 인자 없음(`index.ts:1040`). Node 기본값은 미지정 시 전 인터페이스. `lsof`로 `node ... TCP *:3141 (LISTEN)` 확인.
- **매우 중요**: SECURITY.md는 "Server binds to `localhost` only"라고 명시하나 실제 코드는 그렇지 않다. 문서-코드 불일치이자 보안 회귀.

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

**loopback 차단(403)** — 정상:
`/api/usage`, `/api/tickets`, `/api/runs`, `/api/git/*`, `/api/backends`, `/api/evaluations`, `POST /v1/ingest/web`.

### 2.3 WebSocket (`/ws`)
- Origin **미전송** → `CONNECTED`. 즉시 `snapshot`/`run:snapshot`/`ticket:snapshot`/`system:usage` 전량 수신(모든 세션 데이터).
- Origin `http://evil.example`(원격) → `REJECTED`(소켓 종료). Origin 검사(`wsOrigin.ts`)는 동작.
- **매우 중요**: WS에는 `isLoopbackRequest` 게이트가 없다. `wsClientSchema`에 `terminal:spawn`(mode `shell`/`claude`)이 있으므로, Origin을 보내지 않는 네이티브 클라이언트는 LAN에서 붙어 **원격 PTY 스폰이 가능**하다. 이는 티켓 API 403보다 심각하다.

### 2.4 근거 파일
- 바인딩: `packages/server/src/index.ts:1040`
- HTTP loopback 게이트: `packages/server/src/httpRouter.ts:263`(`isLoopbackRequest`), 라우트별 적용 `:477 :499 :612 :622 :634 :674 :728`
- 게이트 없는 라우트: `httpRouter.ts:379 :394 :432 :442 :704 :710 :716 :742 :762 :792 :808~826`
- WS Origin-only: `packages/server/src/wsOrigin.ts`, 업그레이드 훅 `index.ts:949`
- WS 스폰 스키마: `packages/server/src/wsClientSchema.ts:20`
- ticket-roots 경고만: `index.ts:632`

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
- 로깅: 토큰 값은 어떤 로그·에러에도 출력 금지. 적용 여부(키 이름)만 로깅.
- 실패: 401 + 고정 지연/레이트리밋(브루트포스 완화).

---

## 4. 설계안 (구현 지침)

원칙: **안전한 기본값(secure by default)**. 아무 설정 없이 실행하면 loopback 전용.

1. **바인딩 기본값 복구**
   - `CLAUDE_ALIVE_HOST` 도입, 기본 `127.0.0.1`. `listen(PORT, HOST)`.
   - 회귀 수정이므로 원격 기능과 무관하게 **선행 단독 커밋** 권장.

2. **노출 opt-in + 토큰 강제**
   - `CLAUDE_ALIVE_REMOTE=1`일 때만 외부 바인딩 허용.
   - 이때 `CLAUDE_ALIVE_TOKEN` 미설정 → **부팅 거부**(경고 아님).
   - `CLAUDE_ALIVE_TICKET_ROOTS` 미설정 → 원격 모드 부팅 거부(현재는 경고만).

3. **게이트 반전 + 화이트리스트**
   - 판정식: `isLoopbackRequest(req) || (remoteEnabled && validToken(req) && isRemoteAllowed(method, path))`.
   - **기본은 원격 불가**. 신규 라우트는 명시적으로 화이트리스트에 넣기 전엔 원격 차단(현재는 반대 = 새 라우트가 기본 노출).
   - 원격 허용 후보(최소): `POST /api/tickets`(생성), `GET /api/tickets`(조회), `POST /api/tickets/:id/{cancel,retry,reply}`, `GET /api/status`.
   - **원격 영구 차단**: `terminal:*`(WS), `/api/git/*`, `/api/fs/browse`, `/api/ssh/browse`, `PUT /api/projects/names`.

4. **WS 인증**
   - 업그레이드 시 Origin 검사에 더해 토큰 검증 추가. 토큰 없는 원격 업그레이드 거부.
   - 원격 세션은 `terminal:spawn` 거부(읽기 스냅샷·티켓 이벤트만 허용).

5. **전송/도달**
   - 기본 안내: Tailscale(권장) 또는 SSH 로컬 포워딩. 공개 인터넷 직노출은 문서에서 비권장.
   - 브라우저 앱이 필요하면 Cloudflare Tunnel+Access를 대안으로 문서화.

6. **CSRF/rebinding 방어(브라우저 대비)**
   - 상태변경 라우트는 `Authorization` 헤더 필수(쿠키 인증 금지 → CSRF 자동 완화).
   - `Host` 헤더 화이트리스트 검사(DNS rebinding 완화).

7. **문서 동기화**
   - SECURITY.md의 "localhost only" 문구를 실제 동작(기본 loopback, opt-in 원격+토큰)과 일치시킨다.

---

## 5. 점검 체크리스트

### 현황 확인(측정 완료 = [x])
- [x] 서버 바인딩 인터페이스 확인 → `*:3141` (loopback 아님)
- [x] HTTP 라우트별 LAN 접근 코드 수집(200/403)
- [x] `/api/fs/browse` LAN 열람 가능 확인
- [x] `/api/prompts`·`/api/claude/sessions` 프롬프트 전문 LAN 노출 확인
- [x] `PUT /api/projects/names` LAN 쓰기 성공 확인
- [x] WS Origin-미전송 연결 가능 + snapshot 수신 확인
- [x] WS 원격 Origin 거부 확인
- [x] WS에 loopback 게이트 부재·`terminal:spawn` 스키마 존재 확인
- [x] SECURITY.md 문구와 코드 불일치 확인

### 구현 게이트(미착수 = [ ])
- [ ] `CLAUDE_ALIVE_HOST` 기본 `127.0.0.1` 바인딩
- [ ] `CLAUDE_ALIVE_REMOTE` opt-in, 미설정 시 loopback
- [ ] 원격 모드에서 `CLAUDE_ALIVE_TOKEN` 부재 시 부팅 거부
- [ ] 원격 모드에서 `CLAUDE_ALIVE_TICKET_ROOTS` 부재 시 부팅 거부
- [ ] `timingSafeEqual` 토큰 검증 유틸 + 단위테스트
- [ ] 원격 허용 라우트 화이트리스트(기본 차단) + 테스트
- [ ] WS 업그레이드 토큰 검증 + 원격 `terminal:spawn` 거부 + 테스트
- [ ] 토큰 401 레이트리밋
- [ ] 토큰이 로그·에러에 노출되지 않음(테스트/수동확인)
- [ ] `.env` 파일 권한 0600 검사·경고
- [ ] SECURITY.md 갱신
- [ ] README/CLI 도움말에 원격 모드 활성 절차 + Tailscale 안내

### 재현 명령 (참고)
```bash
IP=$(ipconfig getifaddr en0)
curl -s "http://$IP:3141/api/fs/browse?dir=/"     # 200 → 노출(수정 후 거부돼야 함)
curl -s "http://$IP:3141/api/prompts" | head -c 80 # 200 → 프롬프트 노출
curl -s -o /dev/null -w '%{http_code}\n' \
  -X PUT -H 'Content-Type: application/json' \
  -d '{"cwd":"/tmp/x","name":"X"}' "http://$IP:3141/api/projects/names"  # 200 → 쓰기
# WS: Origin 없이 연결되면 snapshot 수신(수정 후 토큰 없이는 거부돼야 함)
```

---

## 6. 우선순위

1. **[P0] 기본 loopback 바인딩** — 원격 기능과 무관, 즉시 회귀 수정. 이것만으로 §2.2/2.3 노출 전부 차단.
2. **[P0] WS loopback/토큰 게이트** — 현재 원격 PTY 스폰 경로 차단.
3. **[P1] 토큰 인증 + 화이트리스트 + opt-in 원격** — 원격 트리거 본기능.
4. **[P1] 문서 동기화(SECURITY.md/README)**.
5. **[P2] CSRF/rebinding 하드닝, 레이트리밋, 토큰 회전**.
</content>
</invoke>

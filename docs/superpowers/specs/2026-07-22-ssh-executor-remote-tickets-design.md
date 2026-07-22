# 로컬/원격(SSH) 티켓 실행 — Executor 추상화 설계

- **날짜**: 2026-07-22
- **브랜치**: `feat/ticket-ssh-executor` (baseline: 커밋 `7bf1c4b`, decision 기능 이전)
- **범위**: 티켓의 자율 에이전트를 로컬 또는 등록된 SSH 호스트의 지정 폴더에서 headless 실행. 티켓 모델(결과·검증·토큰·평가) 유지.

## 1. 배경 / 목표

현재 티켓은 `claude -p`를 **로컬 자식 프로세스**로만 실행한다(`headlessClaude.ts` `spawn('claude', …, {cwd})`). 사용자는 등록된 SSH(`ssh dev@192.168.100.99`, 키 무암호 인증 완료)를 통해 **원격 머신의 지정 폴더에서** 동일하게 티켓을 돌리길 원한다.

**목표**
- 티켓 생성 시 실행 위치를 **로컬 또는 등록된 SSH 호스트**로 선택.
- 원격 실행도 headless stream-json → 결과·headline·검증·토큰·good/bad 평가가 그대로 동작.
- 실행 경로를 **Executor 추상화**로 통일 → 향후 codex/litellm/hermes 백엔드의 확장점.

**비목표(이번 범위)**
- 원격 프로세스의 확실한 kill(ControlMaster+pkill) — best-effort로, 하드닝은 후속.
- 원격 세션 실시간 개입(훅이 로컬 전용) — 결과 보고까지만, 개입은 SSH 터미널로 대체.
- codex/litellm 실제 연동 — Executor 인터페이스만 마련.
- 호스트별 원격경로 allowlist — v1은 로컬 기본값과 동일하게 미제한(loopback 신뢰경계 유지).

## 2. 데이터 모델 (core, 신규 `tickets/location.ts`)

```ts
export type LocationKind = 'local' | 'ssh';
export interface SshTarget { host: string; user?: string; port?: number; identityFile?: string; }
export interface TicketLocation { kind: LocationKind; ssh?: SshTarget; label?: string; }
```
- `Ticket.location?: TicketLocation` — 없으면 로컬(하위호환).
- `Ticket.cwd`: 로컬이면 로컬 경로, ssh면 **원격 경로**(의미만 위치 종속, 필드는 그대로).
- `TicketCreateInput.location?: TicketLocation`.
- core `index.ts`에서 타입 export.

## 3. Executor 추상화 (server, 신규 `executors/`)

```ts
// executors/types.ts
export interface AgentSpawnRequest { goal: string; cwd: string; permissionMode: string; }
export interface Executor {
  /** 사용 가능 여부. 에러 메시지 or null. */
  validateCwd(cwd: string): Promise<string | null>;
  /** headless 에이전트 스폰. {kill, done: Promise<MainOutcome>}. */
  spawn(req: AgentSpawnRequest): RunnerHeadlessHandle;
}
```

### 3.1 공통 코어 추출 (`headlessClaude.ts` 리팩터)
`runHeadlessClaude`의 "child의 stdout→stream-json 소비, sessionId/usage/stderr 수집, done/kill" 코어를 `consumeHeadless(child, opts?): HeadlessRunHandle`로 추출. 로컬/ssh Executor가 child만 다르게 만들어 공유.
- 기존 `runHeadlessClaude` 시그니처는 유지(내부에서 `consumeHeadless` 사용) — 기존 호출부·테스트 무회귀.

### 3.2 LocalExecutor
- `spawn(req)`: 기존 `runHeadlessClaude({goal, cwd, permissionMode})` 그대로.
- `validateCwd(cwd)`: 로컬 fs — `existsSync`/`realpathSync`/`isCwdAllowed(allowedRoots)`(기존 로직 이동). 실패 시 메시지.

### 3.3 SshExecutor(target: SshTarget, allowedRoots?)
- 원격 커맨드: `cd <shellQuote(cwd)> && claude -p --output-format stream-json --verbose --permission-mode <mode>` (resume 필요 시 `--resume` 후속).
- ssh 인자: `['-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new', ...(-i identity), ...(-p port), target, remoteCommand]`.
- **goal은 원격 커맨드에 넣지 않고 ssh 프로세스 stdin으로 전달** (`claude -p`는 인자 없으면 stdin에서 프롬프트 읽음) → 멀티라인/따옴표 quoting 회피.
- `spawn('ssh', args, {stdio:['pipe','pipe','pipe']})` → `child.stdin.write(goal); child.stdin.end()` → `consumeHeadless(child)`.
- `validateCwd`: `spawn('ssh', [opts, target, `test -d ${shellQuote(cwd)} && echo __OK__`])` → stdout에 `__OK__` 있으면 통과, 아니면 "원격 디렉터리 없음/접속 실패".
- 주입 가능한 `spawnProcess`(테스트용 mock) 포함.

## 4. 러너/검증기 배선 (server)

- `index.ts`: `resolveExecutor(location): Executor` — local | ssh. `spawnMain`이 `resolveExecutor(ticket.location).spawn({goal: buildMainPrompt(...), cwd, mode})`.
- `ticketRunner`: 로컬전용 검증(`cwdExists`/`canonicalize`/`isCwdAllowed` 인라인)을 **주입된 async `validateCwd(ticket): Promise<string|null>`**로 교체. index가 `(t)=>resolveExecutor(t.location).validateCwd(t.cwd)`로 배선. 러너는 위치 무관.
  - 기존 인라인 검증 옵션(`cwdExists`/`canonicalize`)은 LocalExecutor로 이동, 테스트는 executor 주입으로 적응.
- `ticketVerifier`: verify 시 티켓과 **같은 위치**에서 실행 — `run`이 `resolveExecutor(ticket.location).spawn(...).done` 사용하도록.
- HTTP create 동기 `validateCwd`(로컬 statSync)는 로컬에만 적용, ssh는 러너의 async executor 검증에 위임.

## 5. 프로토콜 / API (core + server + ui)

- `TicketCreateBodySchema`(httpRouter Zod)에 `location` 추가:
  `location: z.object({ kind: z.enum(['local','ssh']), ssh: z.object({host, user?, port?, identityFile?}).optional(), label?: }).optional()`.
- create 핸들러가 location을 티켓에 저장.
- WS `ticket:update`는 location 포함(티켓 전체 브로드캐스트라 자동).

## 6. UI

- **NewTicketForm**: 위치 선택 UI — `로컬` + 브라우저 SSH 프리셋 목록(`loadPresets()`; host/user/port/identityFile 보유). ssh 선택 시 cwd 입력 라벨 = 원격 경로. create payload에 `location` 포함(로컬이면 생략 또는 kind:'local').
- **TicketCard / DetailModal**: location 뱃지(예: `⬈ dev@192.168.100.99`), 실행정보에 위치 표시.
- **원격 개입 대체**: 원격 티켓의 "과정 보기/개입"은 로컬 세션점프 대신 **해당 호스트로 SSH 터미널 열기**(프리셋 재사용) 이벤트.
- i18n(ko/en): `tickets.location`, `tickets.locationLocal`, `tickets.locationRemote`, `tickets.remotePathPlaceholder` 등.

## 7. 보안

- create 라우트 loopback 전용 유지 = 1차 신뢰경계(로컬 사용자만 위치·호스트 지정).
- ssh는 `BatchMode=yes`(비대화, 비번 프롬프트 시 즉시 실패) + 키 인증.
- bypassPermissions는 원격에서도 RCE급 → v1 원격 allowlist는 미제공이나, 호스트가 사용자 소유·loopback 지정이라는 전제. 문서에 경고.

## 8. kill / 취소 (best-effort)

- `child.kill()`(로컬 ssh 종료) → 원격 claude는 stdout 파이프 끊김으로 다음 출력 시 SIGPIPE 종료. 완전 보장 아님 → 후속 하드닝(ControlMaster + 원격 pkill) 명시.

## 9. 테스트

- **core**: location 타입(형태) + (필요 시) 기본값 헬퍼.
- **server**: 
  - `SshExecutor.spawn` — mock spawn 주입 → ssh 인자(`cd dir && claude -p …`)·stdin=goal·stream-json 파싱·kill 검증.
  - `SshExecutor.validateCwd` — mock ssh(`__OK__` 유무).
  - `LocalExecutor` — 기존 로컬 검증/스폰 동작.
  - `consumeHeadless` 추출 후 기존 headlessClaude 테스트 무회귀.
  - 러너: 주입 executor로 동작(기존 테스트 적응).
- **회귀**: 전체 tsc·빌드·테스트 통과.

## 10. 구현 단계 (각 단계 tsc/test → 커밋)

1. core: `location.ts` 타입 + export.
2. server: `headlessClaude`에서 `consumeHeadless` 추출(+무회귀).
3. server: `executors/`(types·LocalExecutor·SshExecutor) + 단위 테스트.
4. server: `resolveExecutor` + 러너 `validateCwd` 주입 배선 + verifier 위치 반영 + httpRouter location.
5. ui: NewTicketForm 위치선택 + 카드/모달 뱃지 + 원격 개입 대체 + i18n.
6. 전체 검증 → 커밋.

가역적: location 없으면 전부 기존 로컬 동작과 동일.

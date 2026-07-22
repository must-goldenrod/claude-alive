# 티켓 기반 자율 에이전트 대시보드 설계

- 날짜: 2026-07-21
- 상태: 승인됨 (브레인스토밍 5축 확정 + 설계 1/2·2/2 사용자 승인)

## 배경 / 문제

현재 사용 방식은 대화형이다: 새 채팅 → 터미널 오픈 → 루트에서 `claude` 실행 →
사람이 타이핑으로 입력 → 액션 → 결과를 눈으로 확인. 중간 과정(grep·검색·SQL·tool
호출)이 전부 화면에 노출된다.

목표는 이보다 **진화한 형태**다:

- **입력조차 카드(티켓) 한 장**으로 만들어 던지고, 그 과정을 **보지 않는다**.
- 에이전트가 **완전 자율**로 판단·결정하여 끝까지 처리한다(사람 개입 게이트 없음).
- 카드는 **상태로만** 존재한다: 진행중 / 완료 / 실패.
- 중간 과정(무엇을 grep 했는지, SQL, tool 호출)은 **백에서만** 돌고 유저는 결과만 본다.
- **여러 개를 동시에** 돌려 작업 수행·완료 속도를 끌어올린다.

즉 "에이전트로서 과정을 낱낱이 출력하는 것"조차 스킵하고, 태스크/업무 단위와
**상태로서만** 존재하게 만든다. claude-alive의 관찰(observability) 대시보드 옆에,
이런 스타일의 **실행(execution) 대시보드**를 하나 더 얹는다.

## 범위

MVP는 **핵심 루프**로 한정한다:

> 티켓 생성 → 자율 에이전트 백그라운드 실행 → 진행중/완료/실패 상태만 카드로 표시
> → 여러 개 동시 실행.

- **비범위(YAGNI, 다음 사이클로 분리):**
  - **자체 룰 자동생성**: 과거 세션을 분석해 문제 해결 방식을 파악하고 자체 claude.md 같은
    전역 룰을 스스로 생성하는 하위시스템. 성격이 완전히 다른 독립 연구성 과제라 분리.
  - 티켓 자동 재시도(auto-retry), 티켓 간 의존성/DAG, 멀티유저, 외부(비로컬) 노출.

## 확정된 결정 (브레인스토밍)

| 축 | 결정 |
|---|---|
| MVP 범위 | 핵심 루프만 (자체 룰 자동생성 제외) |
| 자율성 | 완전 자율, 의사결정 게이트 없음 → 상태: 진행중 / 완료 / 실패 |
| 실행 엔진 | Claude Code headless (`claude -p --output-format stream-json`, bypassPermissions) |
| 완료 판정 | 메인 실행 후 별도 검증 에이전트 통과 시 완료 (검증 불확실 → fail-closed) |
| 크래시 복구 | 서버 재시작 시 running/verifying 티켓은 재부착 불가 → failed('interrupted'), 수동 retry |
| 위치 | 기존 claude-alive에 새 'Tickets' 뷰 (server·WS·core 재사용) |
| 오케스트레이션 | 전용 TicketRunner + 파일 영속저장(tickets.jsonl) + 세마포어 동시성 |

## 데이터 흐름

```
[티켓 카드 생성] --HTTP/WS--> TicketStore(영속: tickets.jsonl)
        │
        ▼  (동시성 세마포어, 기본 3)
   TicketRunner ── spawn: claude -p "<goal>" --output-format stream-json
        │              │                        --permission-mode bypassPermissions
        │              └─ stdout(line JSON) → 상태파서:
        │                     system/init, tool_use, text → 진행중(유저에 은닉)
        │                     result                      → 메인 완료
        ▼
   검증 에이전트 spawn (목표 충족 확인) → passed → 완료 / !passed → 실패
        │                                검증 자체 실패 → 실패(fail-closed)
        ▼  WS broadcast(ticket:update)
   [Tickets 뷰] — 카드 상태 + 최종 요약만 표시 (중간 과정 숨김)
```

## 아키텍처

기존 claude-alive 패턴(작은 파일 다수, 의존성 주입으로 순수·테스트 가능)을 따른다.
서버에 이미 존재하는 `codexSupervisor.ts`(자식 프로세스 stdio 감독)와 그 테스트가
`ticketRunner`/`headlessClaude`의 참고 선례다.

### 1. 공유 타입 (`packages/core/src/tickets/`)

- `Ticket` 타입 + `TicketState` + zod 스키마.
- WS 메시지 확장: 기존 `WSServerMessage` 유니온에 `ticket:snapshot`, `ticket:update` 추가.

```ts
type TicketState =
  | 'queued'      // 대기열 (슬롯 없음)
  | 'running'     // 메인 에이전트 실행중
  | 'verifying'   // 검증 에이전트 실행중
  | 'done'        // 검증 통과
  | 'failed';     // 실패 / 검증 불통과 / 타임아웃 / 취소

interface Ticket {
  id: string;               // uuid
  goal: string;             // 카드 한 장의 입력 (심플한 목표)
  cwd: string;              // 작업 디렉터리(프로젝트 루트)
  state: TicketState;
  createdAt: number; startedAt?: number; endedAt?: number;
  result?: string;          // 카드에 보여줄 최종 요약 (done/failed)
  verification?: { passed: boolean; reason: string };
  claudeSessionId?: string; // 내부 세션 링크 (심층조회용, UI 기본 숨김)
  error?: string;           // 실패 사유
}
```

UI는 `queued`+`running`+`verifying`를 "진행중" 한 덩어리로 접어 보여준다(중간 과정
은닉 원칙). 상태는 3개로 보이고 내부는 5개.

### 2. 서버 모듈 (`packages/server/src/`)

- **`ticketStore.ts`** — 영속 저장. `tickets.jsonl` append + 인메모리 인덱스.
  `nameStore.ts`/`managedSessionStore.ts`와 동일 파일 패턴. immutable update(새 객체 반환).
- **`ticketRunner.ts`** — 라이프사이클 엔진. 대기열 + 세마포어(동시성) + 상태 전이 +
  broadcast. `spawn`은 **주입**받아 테스트 가능(`sessionTerminalLink.ts`의 deps 주입 방식).
- **`headlessClaude.ts`** — `claude -p` 인자 빌드 + `child_process.spawn` + stream-json
  라인 파서. `claudeTerminal.ts`의 `cleanEnv`(CLAUDECODE 등 중첩세션 변수 제거) 재사용.
  **PTY 아님** — headless는 TTY 불필요, stdout이 라인 구분 JSON.
- **`ticketVerifier.ts`** — 2차 headless claude를 검증 프롬프트로 spawn →
  구조화된 `{passed, reason}` 판정.
- **배선**: `httpRouter.ts`에 `POST /api/tickets`(생성)·`GET /api/tickets`(목록)·
  `POST /api/tickets/:id/retry`·`DELETE /api/tickets/:id`; `wsServer.ts`에서
  `ticket:snapshot`/`ticket:update` broadcast.

### 3. UI (`packages/ui/src/views/tickets/`)

기존 디자인 시스템 준수: 다크 테마 CSS 토큰(`--bg-primary #0d1117`,
`--accent-blue #58a6ff`), `rounded-xl` 카드, Pretendard(UI)·SF Mono(시간). 모든 텍스트는
`packages/i18n` 키(en/ko) — 하드코딩 금지.

- **`TicketsView.tsx`** — 3열 보드: `진행중 / 완료 / 실패`. 내부 `queued·running·verifying`는
  "진행중" 열에 접어 표시. UnifiedView에 탭으로 편입.
- **`TicketCard.tsx`** — 목표 제목 + 상태 뱃지 + 경과시간(SF Mono). 완료/실패 카드만
  최종 요약(result) 노출. 중간 과정(grep·SQL·tool 호출)은 일절 표시 안 함. 뱃지 색:
  진행중=blue(은은한 pulse), 완료=green, 실패=red.
- **`NewTicketForm.tsx`** — 목표 textarea 한 개 + 프로젝트(cwd) 선택 + "티켓 만들기" 버튼.
- **`useTickets.ts`** — WS 구독 훅. `ticket:snapshot` 초기 로드, `ticket:update` 실시간 갱신
  (기존 `useWebSocket` 패턴 재사용).

## 실행 파이프라인 (TicketRunner 라이프사이클)

```
생성 → queued (영속·broadcast)
   │  슬롯 여유 시 (세마포어, 기본 동시성 3, 설정 가능)
   ▼
running: spawn  claude -p "<goal>"
                  --output-format stream-json
                  --permission-mode bypassPermissions
                  (cwd, cleanEnv)
   │  stdout 라인 JSON 파싱:
   │    system/init      → running 유지
   │    tool_use / text  → running 유지 (유저에 노출 X)
   │    result           → 메인 완료, result 텍스트 캡처
   │  프로세스 exit:
   │    code 0 + result  → verifying 로
   │    비정상 / error    → failed(error)
   ▼
verifying: spawn 2차 claude (검증 프롬프트: 목표 + 변경내용)
   │    → {passed:true}  → done   (result + verdict)
   │    → {passed:false} → failed (verdict.reason)
   │    → 검증 자체 실패  → failed('verification-inconclusive')  // fail-closed
   ▼
슬롯 해제 → 다음 queued 시작
```

각 상태 전이마다 `ticketStore` 갱신 + `ticket:update` broadcast → Tickets 뷰가 실시간 반영.

## 동시성 · 안전성

- **세마포어**: 기본 동시 실행 3, 환경변수/설정으로 조정. 대기열은 무제한(영속).
  "여러 개 동시 실행 → 속도 극대화"의 실체이자 리소스 상한(무제한 spawn 방지).
- **cwd 허용범위 제한**: 티켓은 설정된 허용 루트 안에서만 실행. 범위 밖 cwd 생성 요청
  거부. `bypassPermissions`가 임의 코드 실행이므로 방어선.
- **로컬 전용**: 티켓 HTTP 엔드포인트는 로컬(3141) 바인딩 유지, 외부 노출 금지(RCE 차단).
- **타임아웃**: 티켓별 최대 wallclock(기본 30분, 설정 가능) 초과 → 자식 kill →
  `failed('timeout')`.
- **크래시 복구**: 서버 시작 시 `running`/`verifying`로 남은 티켓 → `failed('interrupted')`
  (재부착 불가), 수동 retry 가능.
- **취소**: 자식 프로세스 kill → `failed('cancelled')`.

## 에러 처리

- `claude` 미발견(ENOENT) → 실행 가능한 메시지와 함께 `failed`.
- stream-json 라인 파싱 실패 → 로그 후 스킵, 프로세스 유지(한 줄 깨졌다고 죽이지 않음).
- 검증 에이전트 자체 실패 → `failed('verification-inconclusive')` (fail-closed).

## 보안 고려

`bypassPermissions` 완전 자율 = cwd에서 임의 코드 실행(RCE 등가). MVP는 로컬 개인 도구
전제라 수용하되 다음을 강제한다:

- 티켓 엔드포인트 로컬 바인딩(외부 노출 금지).
- cwd 허용범위 화이트리스트 검증.
- 외부 서비스가 REST로 목표를 주입하는 확장은 **비범위** — 열려면 인증·인가·소유권
  검증 게이트를 선결해야 한다.

## 테스트 전략 (80% 목표)

- **단위**: `ticketStore`(영속·재로드·immutable), stream-json 파서(픽스처 → 상태전이),
  세마포어(N슬롯 동시성), 검증 verdict 파싱.
- **통합**: 스텁 headless 프로세스(고정 stream-json을 뱉는 작은 node 스크립트)를 `spawn`
  주입으로 넣어 `queued→done` / `→failed` 경로 구동. 크래시복구(running 티켓 있는 store →
  시작 시 failed 표시). 기존 `codexSupervisor.test.ts`·`wsIntegration.test.ts` 패턴 재사용.
- **UI**: `useTickets` 훅을 목 WS로 검증(기존 `useWebSocket.test.ts` 패턴). node 환경
  vitest에 localStorage 스텁 필요 시 목 주입.
- **라이브 claude 호출은 테스트에 없음** — `spawn`을 전부 주입.

## 오픈 이슈 (구현 계획에서 확정)

- 세마포어 동시성 기본값/설정 키 이름(env vs settings).
- 티켓 wallclock 타임아웃 기본값(초안 30분).
- cwd 허용범위의 소스(claude-alive가 이미 아는 프로젝트 목록 재사용 여부).
- 검증 프롬프트에 넘길 "변경내용"의 수집 방식(git diff vs 세션 요약).

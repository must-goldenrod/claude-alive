# 세션 영속화 & 재개(resume) + 에이전트 대시보드 설계

- 날짜: 2026-07-10
- 상태: 승인됨 (사용자가 접근안 A + 전 범위 구현 지시)

## 배경 / 문제

claude-alive의 터미널 세션(pty)은 **브라우저 WebSocket 연결에 묶여** 있다
(`terminals: Map<WebSocket, Map<tabId, ClaudeTerminal>>`). 이 때문에:

- **브라우저 새로고침** → 새 WS 연결 → 기존 pty가 orphan/파괴되고 탭이 사라진다.
- **서버 재시작** → 모든 pty 사망 + `managedSessionIds`(인메모리 Set) 소실 →
  서버가 자기가 띄운 세션조차 식별 못 한다.

목표: 세션을 **껐다 켜도(서버 재시작·브라우저 새로고침 모두) 이어서 사용**할 수 있게
로컬 데이터로 관리한다. 아울러 `list` 메뉴 UI를 세션을 한눈에 보고 되살리는
**에이전트 스타일 대시보드**로 만든다.

## 범위

- 대상: UI가 띄운 **관리 세션(`source: 'spawned-by-ui'`)** 의 Claude 대화.
  외부 세션(`external`, 훅 관찰만)은 프로세스 소유가 없어 resume 불가 — 대시보드에
  live 상태로만 표시.
- resume 수단: Claude CLI `--resume <uuid>` (배관은 이미 존재:
  `buildClaudeCommand`, `ClaudeTerminal.spawn(resumeSessionId)`, UI `openTab(resumeSessionId)`).
- **비범위(YAGNI):** 이벤트 로그·완료 세션 이력의 디스크 영속화(별개 기능),
  SSH 세션 resume(원격 프로세스라 별도), 멀티유저.

## 아키텍처

### 1. 서버 소유 터미널 (`TerminalManager`)

pty를 WS 생명주기에서 분리해 서버가 소유한다.

- `Map<tabId, ManagedTerminal>` (전역, WS 무관).
- `ManagedTerminal`:
  - `pty: ClaudeTerminal`
  - `scrollback: string` — 최근 출력 링버퍼(상한 `SCROLLBACK_MAX_BYTES`, 기본 256KB)
  - `meta: { tabId, claudeSessionId, cwd, displayName, mode, source, claudeVariant }`
  - `subscribers: Set<WebSocket>` — 현재 이 터미널을 보고 있는 클라이언트들
  - `exited: boolean`, `exitCode: number | null`
- 출력 핸들러: scrollback에 append + 모든 subscriber에게 `terminal:output` 전송.
- **WS 연결 끊김(disconnect):** 해당 ws를 모든 subscribers에서 제거. **pty는 죽이지 않는다.**
- **`terminal:close`:** pty destroy + 레지스트리 제거 + 영속화에서 제거(사용자 명시적 종료).

### 2. 영속화 (`managedSessionStore.ts`)

`nameStore` 패턴을 그대로 확장. `~/.claude-alive/managed-sessions.json`.

```
type ManagedSessionRecord = {
  tabId: string
  claudeSessionId: string
  cwd?: string
  displayName?: string
  mode: 'claude' | 'shell'
  claudeVariant: 'claude' | 'agents'
  createdAt: number
  lastActive: number
}
```

- spawn 시 기록, 입력/출력 활동 시 `lastActive` 갱신(디바운스 플러시),
  `terminal:close` 시 제거.
- 상한 `MAX_SESSIONS`(기본 200) — 초과 시 `lastActive` 오래된 것부터 절삭.
- SSH 세션은 저장하지 않는다(`source==='ssh'` 제외).

### 3. 세션 상태 3종

| 상태 | 조건 | 대시보드 액션 |
|------|------|----------------|
| **live (attached)** | 서버에 pty 살아있고 이 브라우저가 subscriber | Focus |
| **detached** | 서버에 pty 살아있으나 이 브라우저는 미구독 (다른 탭/새로고침 직후) | Attach |
| **dormant** | 레지스트리엔 있으나 pty 없음 (서버 재시작 후) | Resume |

### 4. 재연결 흐름

**브라우저 새로고침:** 클라이언트는 열린 탭 목록을 localStorage(`claude-alive:open-tabs`)에
저장한다(`{ tabId, claudeSessionId, cwd, displayName, mode, claudeVariant }[]`).
마운트 + WS open 시 각 탭에 대해 `terminal:attach { tabId }` 전송.
- 서버: `tabId` pty 생존 → subscriber 추가 + `terminal:restore { tabId, data: scrollback }`.
- 서버: pty 없음(재시작) → `terminal:dormant { tabId, claudeSessionId }`.

**서버 재시작:** 부팅 시 레지스트리 로드 → dormant 세션으로 스냅샷의
`resumableSessions`에 포함. `managedSessionIds` 재구성.
- **열린 탭(재시작 시점에 사용자가 열어둔 탭):** attach 응답이 `terminal:dormant`이면
  UI가 **그 자리에서 자동 resume**한다(같은 tabId로 `terminal:spawn { resumeSessionId }`).
  사용자 개입 없이 대화가 이어진다.
- **닫혀 있던(대시보드의) dormant 세션:** 자동 재개하지 않는다. 대시보드 카드 클릭 →
  `terminal:resumeExternal { sessionId, cwd }` → 새 탭에서 `claude --resume`(lazy).

### 5. UI: `list` → 에이전트 대시보드 (`SessionDashboardView`)

현재 `AgentListView`(사이드바 + 빈 본문)를 대시보드로 교체/증강.

- 카드 그리드: 관리 세션(live/detached/dormant) + 외부 live 에이전트.
- 카드 표시: 프로젝트명, displayName, 상태 배지, lastPrompt 요약, 상대시간.
- 액션: **Focus**(live) / **Attach**(detached) / **Resume**(dormant) / **Close**.
- 클릭 시 기존 이벤트(`terminal:focusTab` / `openTab`)로 터미널 오버레이 연결.
- 사이드바는 유지(좌측), 본문 빈 영역 대신 대시보드 렌더.

## 프로토콜 변경 (`wsProtocol.ts`)

서버→클라이언트 추가:
- `terminal:restore { tabId, data }`
- `terminal:dormant { tabId, claudeSessionId }`
- `sessions:resumable { sessions: ResumableSession[] }`
- `snapshot`에 `resumableSessions: ResumableSession[]` 필드 추가.

클라이언트→서버 추가:
- `terminal:attach { tabId }`

`ResumableSession = { tabId, claudeSessionId, cwd?, displayName?, mode, claudeVariant, lastActive }`

## 데이터 흐름

```
[spawn]  UI openTab → terminal:spawn → TerminalManager.create(pty) → registry.persist
[refresh] UI(mount) → terminal:attach → alive? restore(scrollback) : dormant
[restart] server boot → registry.load → snapshot.resumableSessions
          UI dashboard(dormant card) → openTab(resume) → terminal:spawn{resume} → claude --resume
[close]  UI → terminal:close → pty.destroy + registry.remove
```

## 에러 처리

- 영속화 파일 파손/부재 → 빈 레지스트리로 degrade(기존 nameStore와 동일).
- attach 대상 tabId가 레지스트리에도 없음 → dormant도 아니고 무시(클라이언트가 stale 탭 제거).
- resume spawn 실패(CLI 오류) → 기존 `terminal:exited` 경로로 표면화.
- scrollback 상한 초과 → 앞부분 절삭(부분 화면 복원 허용).

## 테스트

- `managedSessionStore`: load/save/trim/파손파일 degrade (유닛).
- `TerminalManager`: create→attach(restore)→disconnect(pty 생존)→close(파괴),
  scrollback 상한 절삭 (유닛, pty는 페이크 주입).
- 프로토콜 타입: 컴파일 통과.
- 대시보드: 상태별 카드/액션 렌더 (컴포넌트, 가능 범위).

## 파일 목록

- core: `protocol/wsProtocol.ts`(수정)
- server: `managedSessionStore.ts`(신규), `terminalManager.ts`(신규),
  `index.ts`(재배선), `__tests__/*`(신규)
- ui: `views/chat/openTabsStore.ts`(신규), `views/chat/ChatOverlay.tsx`(수정),
  `views/dashboard/hooks/useWebSocket.ts`(수정), `App.tsx`(수정),
  `views/list/SessionDashboardView.tsx`(신규)
- i18n: `locales/{en,ko}.json`(대시보드 키 추가)

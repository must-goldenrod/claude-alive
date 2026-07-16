# 자비스 뷰 · 스프레드 뷰 개발 기획 / Jarvis View & Spread View Design

- 작성일: 2026-07-15
- 대상: `packages/ui`, `packages/server`, `packages/core`
- 상태: 설계 확정 대기 (구현 착수 전)
- 개정: 2026-07-15 교차검증 반영 — I1(ResizeObserver churn)·I2(프리필 모순)·I3(갭 프레이밍)·I4(spawn 상관)·I5(실행 컨텍스트) + 문서 정확도 보정

---

## 0. 이 문서의 범위

두 개의 신규 뷰를 추가한다.

- **스프레드 뷰(Spread View)** — 버튼 한 번으로 현재 열려 있는 모든 터미널을 한 화면에 격자로 동시에 출력하고, 하나를 골라 실제로 조작할 수 있게 한다.
- **자비스 뷰(Jarvis View)** — 텍스트를 받아 답변하고 관련 작업을 디스패치하는 커맨드 센터. 그 작업 진행 상황을 작은 터미널 타일 + 픽셀 오피스와 섞어서 한 화면에 보여준다.

**의도적으로 범위에서 제외한 것 (Non-goals):**

- 음성 입력(STT) — 사용자가 외부에서 텍스트로 변환해 넣는다. 이 시스템은 "텍스트가 도착한다"만 전제한다.
- 음성 출력(TTS) — 현 단계 제외. 자비스 출력은 텍스트다.
- 파괴적 작업(터미널 종료·kill)을 자비스가 대행하는 것 — MVP 가드레일로 금지.
- 기존 뷰(animation/list/prompt/efficio)의 동작 변경.

> 이 문서는 위에서 합의된 본질에만 집중한다. 웨이크워드, 오프라인 모드, 분석/로깅 파이프라인, 권한 시스템 확장 등 논의되지 않은 항목은 추가하지 않는다.

---

## 1. 현행 아키텍처 (설계 근거)

문서를 자기완결적으로 만들기 위해, 두 기능이 얹히는 실제 구현을 요약한다. (코드 확인 완료)

### 1.1 뷰 시스템

- `App.tsx`: `ViewMode = 'animation' | 'list' | 'prompt' | 'efficio'`. 각 뷰는 `position:absolute; inset:0` 컨테이너를 `display`로 토글 (`App.tsx:391–433`).
- `HeaderBar.tsx`: `VIEW_MODES` 배열이 상단 세그먼트 컨트롤을 정의 (`HeaderBar.tsx:98`).
- **뷰 추가는 정형 경로**: `ViewMode` union + `VIEW_MODES` 항목 + App 컨테이너 div + i18n 키(`viewMode.*`).

### 1.2 터미널 (서버 소유 pty)

- `terminalManager.ts`: pty를 `tabId`로 소유. WebSocket 수명과 분리. **한 터미널을 여러 클라이언트가 구독**(`subscribers: Set<WebSocket>`) + `fanout`.
- pty당 약 256K자(UTF-16 유닛, 바이트 아님) 스크롤백 링버퍼 → attach 시 재생 + SIGWINCH 강제 재그리기(`forceRedraw`).
- `claudeTerminal.ts`: `node-pty`로 로그인 셸 안에서 `claude` 실행. `buildClaudeCommand`가 커맨드 문자열 구성.
- **크기(cols/rows)는 pty당 1개이고, resize는 실제 pty로 전달**(`terminal:resize` → SIGWINCH). 그 pty의 모든 구독자가 같은 화면을 본다.

### 1.3 프론트 터미널 UI (`ChatOverlay.tsx`)

- 탭당 xterm 1개. **모든 xterm 컨테이너는 `document.createElement`로 만들어 단일 `wrapperRef` div에 `appendChild`** 되며, React가 렌더하지 않는다(`containersRef` 맵으로 명령형 관리, `ChatOverlay.tsx:456–486`).
- 활성 탭만 `display:block`, 나머지는 `display:none` (`ChatOverlay.tsx:855–866`).
- `FitAddon.fit()`은 (a) 각 탭 마운트 시 1회(`mountTerminalUI`, 비활성 탭도 포함) + (b) 이후 자동 경로(ResizeObserver)에서 **활성 탭에 대해서만** 호출된다. 결과 cols/rows를 `onResize`로 서버에 보낸다.
- **함의(중요):** 터미널 DOM은 ChatOverlay가 명령형으로 소유한다. 따라서 여러 터미널을 격자로 보여주는 기능은 **ChatOverlay 내부(또는 ChatOverlay가 구동)** 여야 하며, 터미널을 소유하지 않는 별도 형제 컴포넌트로 만들 수 없다.

### 1.4 서버 메시지 배선

- `wsServer.ts`: `ping`/`request:snapshot`은 인라인 처리, 그 외는 `onClientMessage(ws, msg)`로 위임. `broadcaster.send(ws, msg)`는 단일 클라이언트에게, `broadcast(msg)`는 전체에게.
- `index.ts:251–331`: `onClientMessage`가 `terminal:spawn|attach|input|resize|close`를 `TerminalManager`로 라우팅.
- 스냅샷/상태: `store`(SessionStore) + `getResumableSessions()` + `getProjectNames()`.

### 1.5 UI가 이미 노출하는 조작 트리거 (재사용 대상)

| 동작 | 기존 트리거 |
|---|---|
| 챗 생성(폴더 선택 후) | `window` CustomEvent `terminal:createTab` → CWD 피커 오픈 |
| 탭/에이전트 포커스 | CustomEvent `terminal:focusTab` `{ sessionId?, tabId? }` |
| 외부 세션 재개 | CustomEvent `terminal:resumeExternal` `{ sessionId, cwd }` → `createTab({resumeSessionId})` |
| 기존 탭에 입력 전송 | WS `terminal:input` |
| 신규 스폰(직접, cwd 지정) | `createTab`은 이미 cwd 지정 스폰을 지원(피커 불필요 — `resumeExternal`이 증거, `ChatOverlay.tsx:711`). 다만 이를 트리거하는 전용 이벤트만 없음 → 이벤트 1개 배선 필요(§6.5) |

---

## 2. 공통 결정사항

1. **분해 순서**: 스프레드 뷰를 **먼저** 구현한다. 스프레드의 "미니 라이브 타일" 메커니즘이 자비스 뷰의 빌딩 블록이기 때문이다(§6.6에서 재사용).
2. **뷰 추가**: `ViewMode`에 `'spread'`, `'jarvis'` 추가. HeaderBar 세그먼트에 두 버튼 추가. i18n 키 `viewMode.spread`, `viewMode.jarvis` (EN/KO 필수).
3. **터미널 소유권 불변**: 두 기능 모두 ChatOverlay의 `containersRef`/`termsRef`를 단일 소유원으로 사용한다. 터미널 인스턴스를 이중으로 만들지 않는다.

---

## 3. 스프레드 뷰 — 요구사항

- 현재 열려 있는 모든 터미널 탭(Claude/SSH/shell 포함)을 한 화면에 격자로 동시에 출력한다.
- 각 타일은 작게라도 실제 화면 내용을 보여준다(빈 껍데기가 아님).
- 격자는 타일 개수에 따라 크기/열 수가 자동 조정된다.
- 사용자는 타일 하나를 골라 **실제로 조작**할 수 있어야 한다.
- 진입/이탈은 HeaderBar의 `spread` 버튼(또는 토글)로 한다.

---

## 4. 스프레드 뷰 — 설계

### 4.1 핵심 제약과 전략 선택

**제약:** §1.2 — pty 크기는 pty당 1개이고 resize는 실제 Claude TUI를 리플로우시키며 모든 구독자에 공유된다. 따라서 각 타일을 작은 셀에 `fit()`하면, 실제 Claude 화면이 좁게 뭉개지고 그 상태가 다른 브라우저/뷰에도 전파된다.

**채택 전략: 하이브리드 (개요 = CSS scale 스냅샷, 조작 = 클릭 승격)**

- **개요(overview):** 각 xterm을 마지막으로 알려진 크기 그대로 두고, 담는 셀에 `transform: scale(f)` + `transform-origin: top left` + `overflow: hidden`을 적용해 시각적으로 축소한다. **`fit()`/`resize`를 호출하지 않으므로 pty 크기 불변 → 리플로우/공유 churn 없음.**
- **조작(operate):** 타일 클릭 → 그 탭을 활성으로 만들고 스프레드를 이탈(직전 모드로 복귀)한다. 복귀 시 정상 `fit()`이 pty를 실제 크기로 되돌린다. "다 보고, 하나씩 승격해 운영".

> 대안(실시간 축소 타일)은 전 타일 동시 조작이 가능하지만 pty를 작게 리플로우시키는 churn을 유발하므로 채택하지 않는다. (설계 리스크 검토는 §7)

### 4.2 메커니즘 (ChatOverlay 내부)

새 prop `spreadActive?: boolean`을 ChatOverlay에 추가한다(App이 `viewMode === 'spread'`로 전달; `listViewActive`와 동일한 패턴).

`spreadActive`가 true일 때:

1. `wrapperRef`를 CSS Grid로 전환한다.
   - 열 수: `cols = ceil(sqrt(n))`, 행 수: `rows = ceil(n / cols)` (n = 표시 대상 타일 수).
   - `grid-template-columns: repeat(cols, 1fr)`, `gap`, 셀 비율은 `aspect-ratio` 또는 `1fr` 행.
2. 각 컨테이너를 격자 셀로 만든다.
   - `display: block`으로 모두 표시(기존엔 활성만 표시).
   - 각 컨테이너를 "셀 래퍼"로 감싸거나, 컨테이너 자체에 스케일을 적용한다. 스케일 계수 `f = min(cellW / termPixelW, cellH / termPixelH)`.
   - `pointer-events`는 개요에서 셀 래퍼가 가로채고(클릭=승격), 내부 xterm으로는 전달하지 않는다(개요에서 오작동 입력 방지).
3. 각 셀 상단에 얇은 라벨 바(탭 label + 상태 점 + exited/dormant 배지)를 오버레이한다. 상태 색은 기존 `Tab.status`(idle/active/waiting/done) 재사용.
4. 클릭 시 `onSelectSpreadTile(tabId)` → App이 `viewMode`를 직전 뷰로 되돌리고 `activeTabId`를 해당 탭으로 설정. ChatOverlay는 기존 활성 전환 로직으로 `fit()` 수행.

**[필수/I1] 진입 시 자동 fit churn 차단:** ChatOverlay의 ResizeObserver(`ChatOverlay.tsx:911`)는 `wrapperRef`를 관찰하며 콜백에서 **활성 탭을 자동 `fit()` + `onResize` 브로드캐스트**한다. 스프레드 진입이 wrapper 측정 박스를 바꾸면 활성 타일 1개가 리플로우되고 전 구독자에 `terminal:resize`가 나가 — §4.1이 피하려던 바로 그 churn이 재발한다. 따라서 `spreadActive` 동안 **ResizeObserver를 disconnect(또는 콜백 가드)** 하고, 활성 전환·모드 변경에 걸린 지연 `fit()` 이펙트(`ChatOverlay.tsx:925–946`)도 스킵한다. (스프레드 *이탈* 시 `fit()`은 step4의 의도된 동작이므로 그대로 둔다.) 발화 조건은 wrapper 외곽 박스 변화 여부에 달렸으나, 안전을 위해 조건과 무관하게 disconnect한다.

**스케일 스냅샷이 "라이브"인 이유:** xterm 인스턴스는 계속 살아 있고 `terminal:output`을 계속 수신·렌더한다. 스케일은 CSS 변환일 뿐이므로, 축소된 타일도 실시간으로 갱신된다. 별도 스냅샷 캡처 로직이 필요 없다.

### 4.3 표시 대상과 정렬

- 대상: `tabs` 전체(활성 여부 무관). exited/dormant 포함하되 배지로 구분.
- 정렬: `tabs` 배열 순서 유지(사용자가 정한 탭 순서 = 격자 순서).

### 4.4 통합 지점 (파일별)

| 파일 | 변경 |
|---|---|
| `packages/ui/src/App.tsx` | `ViewMode`에 `'spread'`; `spread` 컨테이너 div; `<ChatOverlay spreadActive={viewMode==='spread'} onSelectSpreadTile={...} />` |
| `packages/ui/src/components/HeaderBar.tsx` | `VIEW_MODES`에 `{ mode:'spread', labelKey:'viewMode.spread' }` |
| `packages/ui/src/views/chat/ChatOverlay.tsx` | `spreadActive` prop; 래퍼 grid 전환 + 셀 스케일 + 라벨 바 + 클릭 승격 |
| `packages/i18n/src/locales/{en,ko}.json` | `viewMode.spread`, 스프레드 라벨/빈상태 문자열 |

신규 WS 메시지·서버 변경 **없음**. 스프레드 뷰는 순수 프론트엔드 기능이다.

### 4.5 예외 / 엣지 케이스

| 케이스 | 처리 |
|---|---|
| 열린 탭 0개 | 빈 상태 안내("열린 터미널 없음") + 새 챗 버튼 |
| 탭 1개 | 격자 1칸(= 그 타일). 별도 분기 불필요 |
| 탭 과다(예: 16개 초과) | 격자가 과도하게 작아짐 → 세로 스크롤 허용(고정 최소 셀 크기) 또는 상한 후 "+N more". **상한을 두면 반드시 UI에 명시**(무언 truncation 금지) |
| exited/dormant 탭 | 타일은 마지막 스크롤백을 보여주되 "종료/휴면" 배지, 클릭 시 승격→기존 resume 흐름(`terminal:dormant` 처리) |
| 아직 fit 안 된 탭(비활성 상태로 생성됨) | 마지막으로 알려진 크기로 스케일. 크기가 없으면 기본 80×24로 렌더 후 스케일(개요 목적상 허용) |
| SSH/shell 탭 | 동일하게 타일로 포함(터미널이므로) |
| 스프레드 중 WS 재연결 | 기존 attach 흐름이 그대로 동작 → `forceRedraw`로 각 타일 재도색 |
| 스프레드 중 탭 종료(`terminal:exited`) | 해당 타일에 종료 배지 표시(격자에서 제거하지 않음) |
| 스프레드 중 새 탭 생성 | 격자 재계산(cols/rows) 후 새 타일 추가 |
| 진입 시 키보드 포커스 유입(I1-S5) | `mountTerminalUI`/활성 전환이 xterm에 `focus()`를 건다. 개요에서 직전 활성 xterm이 포커스를 유지하면 `pointer-events:none`으로도 **키 입력은 막히지 않아** 그 터미널로 샌다. 진입 시 활성 xterm `blur()` 필수 |
| never-fit 탭 scale 계수(I1-S6) | 마운트 fit이 안 된 탭은 픽셀 크기가 없으므로 `f`를 `cols×cellWidth` 기반으로 유도(구현 뉘앙스, 블로커 아님) |

---

## 5. 자비스 뷰 — 요구사항

- 텍스트를 입력받아 **답변(텍스트)** 을 돌려준다.
- 필요 시 **작업을 디스패치**한다(새 챗 열기 등) — 단, 실제 작업은 **눈에 보이는 터미널 안**에서 일어나야 한다.
- 진행 중인 작업을 **작은 터미널 타일 + 픽셀 오피스**와 섞어 한 화면에 보여준다.

---

## 6. 자비스 뷰 — 설계

### 6.1 컨시어지 아키텍처: B-3+ (디스패처 + 상태 오라클)

**결정 근거:** 자비스 뷰의 목적은 "작업 진행을 작은 터미널 뷰로 본다"이다. 그러려면 작업이 보이는 터미널에서 일어나야 한다. 컨시어지가 직접(숨은 프로세스에서) 작업하면 타일에 보여줄 것이 없다. 따라서 컨시어지는 **직접 일하지 않고 보이는 터미널로 작업을 밀어넣는 디스패처**여야 한다.

컨시어지의 두 역할:

1. **오라클(읽기):** 대시보드 상태(에이전트 맵·완료 로그·재개가능 세션·프로젝트명)를 요약해 텍스트로 답한다.
2. **디스패처(쓰기):** 사용자 의도를 정해진 액션으로 매핑해 보이는 터미널에 작업을 시작시킨다.

순수 의도분류(고정 커맨드)로만 두면 뻣뻣하므로, **작은 tool-use 루프**를 얹는다("프로젝트 찾기 → 챗 열기 → 확인"처럼 몇 단계 체이닝).

### 6.2 브레인 구현

**기본값: 헤드리스 `claude -p` + 바운디드 툴 인터페이스.**

- 근거: 이 프로젝트는 이미 `claude` CLI를 구동한다(`claudeTerminal.ts`). 사용자의 기존 Claude 인증을 재사용하므로 별도 API 키 관리가 없다.
- 실행: 서버에 `conciergeAgent.ts` 모듈 추가. `claude -p "<message>" --output-format json`(또는 stream-json)을 일반 프로세스로 실행(터미널 pty가 아니라 — 화면 표시가 목적이 아니므로). 툴은 MCP config 또는 구조화 출력 파싱으로 노출.
- **[I5] 실행 컨텍스트 주의:** 기존 대화형 claude는 **로그인 셸 안에서** 실행되어(`$SHELL -l -c`, `claudeTerminal.ts:163`) PATH·인증을 상속한다. 헤드리스 브레인도 동일하게 로그인 셸을 경유(`$SHELL -l -c 'claude -p …'`)해 PATH/인증 패리티를 보장한다. 맨 `child_process`로 `claude`를 직접 실행하면 PATH·인증 상속이 보장되지 않는다(§9 미결정).
- 컨텍스트 연속성: 대화 이어가기가 필요하면 `--resume`로 세션 유지(선택). 서버 재시작 시 세션은 새로 시작한다.
- **대안:** Anthropic Messages API 직접(B-2). API 키가 필요하지만 툴 정의가 1급으로 깔끔. 이 선택은 구현 단계 세부로 남긴다(§9 미결정).

> 브레인 실체(헤드리스 claude vs API)는 컨시어지의 **입출력 계약**(§6.4)이 고정되면 교체 가능하다. 계약을 먼저 못 박고 브레인은 그 뒤에 붙인다.

### 6.3 능력 범위 (가드레일 포함)

기존 서버/UI 자산 위에 아래로 **한정**한다.

| 구분 | 능력 | 재사용 자산 |
|---|---|---|
| **읽기(오라클)** | 에이전트·상태 조회, 완료 로그, 재개가능 세션, 프로젝트명 | `store`(SessionStore) 스냅샷, `getResumableSessions()`, `getProjectNames()` |
| **쓰기(디스패치)** | ① 프로젝트(cwd)에 챗 spawn(+초기 프롬프트) ② 탭/에이전트 focus ③ 세션 resume ④ 기존 탭에 프롬프트 전송 | ① 신규 직접-스폰 이벤트(§6.5) ② `terminal:focusTab` ③ `terminal:resumeExternal` ④ `terminal:input` |
| **가드레일** | 종료·kill 등 파괴적 작업 제외. spawn은 cwd가 확인될 때만. 액션은 화이트리스트 밖이면 거부 | — |

### 6.4 프로토콜 (신규 메시지)

컨시어지는 서버(브레인) ↔ 요청한 클라이언트(실행자) 사이를 왕복한다. 실행자는 UI다(터미널 xterm을 마운트할 수 있는 유일한 쪽).

신규 `WSClientMessage`:

```ts
| { type: 'concierge:message'; requestId: string; text: string }
```

신규 `WSServerMessage`:

```ts
// 텍스트 답변 (요청한 ws에게만 send)
| { type: 'concierge:reply'; requestId: string; text: string; done: boolean }
// 실행할 액션 목록 (요청한 ws에게만 send). UI가 기존 트리거로 실행한다.
| { type: 'concierge:action'; requestId: string; actions: ConciergeAction[] }
```

```ts
type ConciergeAction =
  | { kind: 'spawn'; cwd: string; initialPrompt?: string }
  | { kind: 'focus'; sessionId?: string; tabId?: string }
  | { kind: 'resume'; sessionId: string; cwd?: string }
  | { kind: 'send'; tabId: string; text: string };
```

- `requestId`로 요청/응답을 짝짓는다(동시 메시지 대비).
- 응답은 `broadcast`가 아니라 `broadcaster.send(ws, ...)` — **요청한 클라이언트에게만**. (여러 브라우저가 붙어 있어도 남의 화면에 남의 액션이 실행되면 안 됨.)

### 6.5 액션 실행 (UI 측)

`concierge:action` 수신 시 UI는 각 액션을 **기존 메커니즘**으로 실행한다.

| 액션 | 실행 |
|---|---|
| `focus` | `window.dispatchEvent(new CustomEvent('terminal:focusTab', { detail }))` (기존) |
| `resume` | `terminal:resumeExternal` 이벤트 (기존) |
| `send` | WS `terminal:input` (기존) |
| `spawn` | **신규**: `terminal:spawnDirect` 이벤트 → ChatOverlay가 `createTab({ cwd, ... })` 직접 호출 |

**신규 플럼빙(spawn):** 현재 `terminal:createTab`은 CWD 피커를 열 뿐 직접 스폰하지 않는다. 자비스는 cwd를 이미 알고 스폰해야 하므로, ChatOverlay에 `terminal:spawnDirect` `{ cwd, initialPrompt? }` 리스너를 추가해 `createTab`을 곧장 호출한다. (createTab은 이미 존재; 새 이벤트만 배선.)

**초기 프롬프트 주입 [I2]:** 액션의 `initialPrompt`는 createTab의 `initialCommand` 필드로 매핑된다(**명칭 상이 주의** — createTab에 `initialPrompt`는 없음). 단 기존 `initialCommand`는 스폰 120ms 뒤 pty에 `${cmd}\r`를 write하므로 **자동 제출(엔터 포함)** 이다(`claudeTerminal.ts:196`). §6.8의 안전 기본값은 "프리필(제출 안 함)"이므로, **`\r` 없이 write하는 no-submit 변형이 필요**하다(기존 `initialCommand`를 그대로 재사용하면 프리필 불가). 자동 제출은 명시적 옵트인일 때만 `\r`를 붙인다. 어느 경우든 Claude TUI 준비 전 write 시 유실 가능(§6.8 엣지).

### 6.6 뷰 레이아웃 (합성)

한 화면에 세 요소를 섞는다. 기본 배치(목업으로 확정 예정):

```
┌───────────────────────────── Jarvis View ─────────────────────────────┐
│ ┌───────────────┐ ┌───────────────────────────────────────────────┐  │
│ │  대화 패널     │ │  관련 작업 영역                                 │  │
│ │  (텍스트 I/O)  │ │  ┌── 미니 터미널 타일(스프레드 타일 재사용) ──┐ │  │
│ │               │ │  │ t1 ▸   t2      t3                          │ │  │
│ │  > 사용자      │ │  └────────────────────────────────────────────┘ │  │
│ │  < 컨시어지    │ │  ┌── 픽셀 오피스(에이전트 워크 시각화) ────────┐ │  │
│ │  [액션 카드]   │ │  │  (기존 PixelCanvas)                         │ │  │
│ └───────────────┘ │  └────────────────────────────────────────────┘ │  │
│                    └───────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

- **대화 패널(좌):** 텍스트 입력창 + 메시지 로그. 컨시어지가 실행한 액션은 "액션 카드"로 인라인 표기(무엇을 했는지 가시화).
- **미니 터미널 타일(우상):** §4의 스케일 타일 컴포넌트를 재사용하되, **자비스가 방금 spawn/참조한 탭만** 필터해서 보여준다("관련된 작업").
  - **[I4] 상관(correlation) 메커니즘:** 필터셋은 클라이언트가 유지한다. `concierge:action` 실행 시 UI가 다루는 tabId를 그 셋에 등록한다 — `spawn`은 `createTab`의 **반환 tabId**(`ChatOverlay.tsx:547`), `focus`/`resume`/`send`는 액션이 실은 `tabId`/`sessionId`. 따라서 `spawn` 액션 페이로드는 결과 tabId를 서버로 되돌릴 필요가 없다(로컬 생성이므로 프로토콜 변경 불요).
- **픽셀 오피스(우하):** 기존 `PixelCanvas` 재사용(에이전트 워크 시각화).

### 6.7 데이터 흐름 (시퀀스)

```
[사용자 텍스트 입력]
   → WS concierge:message { requestId, text }
[서버 conciergeAgent]
   → 상태 읽기(store/resumable/projectNames) + tool-use 루프
   → 답변 텍스트 + 액션 결정
   → send(ws, concierge:reply { text, done })
   → send(ws, concierge:action { actions })
[UI 자비스 뷰]
   → 답변을 대화 로그에 append
   → 각 액션을 기존 트리거로 실행 (spawn/focus/resume/send)
   → spawn된 탭이 미니 타일 + 픽셀 오피스에 등장 → "작업 진행" 가시화
```

### 6.8 예외 / 엣지 케이스

| 케이스 | 처리 |
|---|---|
| 브레인 실패/타임아웃 | 대화 로그에 에러 메시지, 액션 미실행. 타임아웃 상한 설정(예: N초) |
| 액션이 미지의 프로젝트/cwd 참조 | 해당 액션 거부 + 사용자에게 이유 통지(피커로 폴백하지 않음, 무단 스폰 금지) |
| spawn 시 cwd 확인 불가 | 액션 거부, "어떤 프로젝트?" 되물음 |
| 초기 프롬프트 주입 레이스(Claude TUI 미준비) | 지연/재시도. 안전 기본은 **프리필**(`\r` 없이 write, 엔터는 사용자). 이는 기존 `initialCommand`(자동 `\r`)의 **no-submit 변형**을 요구함(§6.5, I2) |
| 동시 다발 concierge:message | `requestId`로 구분, 클라이언트별 직렬화(큐잉) |
| 파괴적 의도(종료/kill) | 가드레일로 거부, "그건 직접 해주세요" 안내 |
| 참조한 에이전트가 방금 despawn됨 | stale로 처리, 상태 재조회 후 "이미 종료됨" 응답 |
| 서버 재시작 중 대화 | 브레인 세션 휘발 → 새 대화로 시작(과거 맥락은 --resume 성공 시에만 유지) |
| 여러 브라우저 접속 | 응답/액션은 요청한 ws에게만 send. 남의 화면에서 실행되지 않음 |
| 헤드리스 claude 동시 실행 비용 | 클라이언트별 1개로 제한(직렬화). 무한 팬아웃 방지 |

### 6.9 통합 지점 (파일별)

| 파일 | 변경 |
|---|---|
| `packages/core/src/protocol/wsProtocol.ts` | `concierge:message`(client), `concierge:reply`·`concierge:action`(server), `ConciergeAction` 타입 |
| `packages/server/src/conciergeAgent.ts` | **신규** — 헤드리스 브레인 + tool-use 루프 + 상태 읽기 |
| `packages/server/src/index.ts` | `onClientMessage`에 `concierge:message` 분기 → conciergeAgent 호출 → `send(ws, …)` |
| `packages/ui/src/App.tsx` | `ViewMode`에 `'jarvis'`; jarvis 컨테이너; concierge 메시지 라우팅 |
| `packages/ui/src/views/jarvis/*` | **신규** — 대화 패널, 액션 카드, 레이아웃. 미니 타일·PixelCanvas는 재사용 |
| `packages/ui/src/views/chat/ChatOverlay.tsx` | `terminal:spawnDirect` 리스너(직접 createTab) |
| `packages/ui/src/components/HeaderBar.tsx` | `VIEW_MODES`에 `jarvis` |
| `packages/i18n/src/locales/{en,ko}.json` | `viewMode.jarvis`, 자비스 UI 문자열 |

---

## 7. 정합성 검토 결과

두 기능이 기존 아키텍처·서로와 모순 없이 맞물리는지 점검했다.

**정합 확인:**

1. **뷰 추가 경로** — `ViewMode` union + `VIEW_MODES` + App 컨테이너 패턴은 기존 4개 뷰와 동일. 두 뷰 추가는 이 경로에 정확히 부합.
2. **터미널 소유권 단일화** — 스프레드/자비스 모두 ChatOverlay의 `containersRef`/`termsRef`를 단일 소유원으로 쓴다. 터미널 이중 인스턴스 없음. (스프레드가 별도 컴포넌트가 아니라 ChatOverlay 내부/구동인 이유.)
3. **스케일 스냅샷 ↔ pty 크기 공유 제약** — scale 자체는 CSS 변환이라 `fit()`/`resize`를 호출하지 않는다. **단, 이것만으로는 불충분하다(교차검증 I1):** 스프레드 진입이 wrapper 박스를 바꾸면 ResizeObserver가 활성 탭을 자동 `fit()`해 §1.2 공유 churn이 재발한다. §4.2의 "진입 시 ResizeObserver disconnect"를 함께 적용해야 완전히 우회된다. 그 전제가 지켜지면 한 브라우저가 스프레드, 다른 브라우저가 풀스크린이어도 충돌 없음.
4. **컨시어지 서버 브레인 ↔ 클라이언트 실행자 분리** — 브레인은 프로세스(서버)라 서버측, xterm 마운트는 UI만 가능하므로 실행은 클라이언트측. `send(ws)`로 요청자에게만 왕복 → 기존 단일-클라이언트 send 패턴과 일치.
5. **자비스 미니 타일 = 스프레드 타일 재사용** — 의존성 순방향(스프레드 먼저). 동일 스케일 타일 컴포넌트를 필터만 달리해 사용.

**검토에서 드러난 필수 신규 플럼빙(갭):**

6. **직접 스폰 트리거(경미, I3)** — `createTab`은 이미 cwd 지정 스폰을 피커 없이 수행한다(`resumeExternal`이 증거, `ChatOverlay.tsx:711`). 따라서 이는 **구조적 갭이 아니라 기존 `resumeExternal` 패턴을 본뜬 이벤트 1개 배선**이다(`terminal:spawnDirect`, §6.5). 작업량은 낮다.

**검토에서 확인된 리스크(설계에 반영됨):**

7. **초기 프롬프트 주입 타이밍/제출(I2)** — `initialCommand`는 120ms 고정 지연 + 자동 `\r` 제출이라 (a) TUI 준비 전 유실 가능, (b) 프리필 기본과 모순. → no-submit 변형 사용, 프리필 기본(§6.5/§6.8).
8. **헤드리스 claude 비용/동시성** — 클라이언트별 1개 직렬화로 제한(§6.8).
9. **스프레드 타일 과다** — 무언 truncation 금지, 상한 시 UI 명시(§4.5).
10. **[I1] 스프레드 진입 시 ResizeObserver churn** — scale만으로 불충분, 진입 중 ResizeObserver disconnect 필수(§4.2/§7.3). 활성 xterm `blur()`로 키 입력 유입도 차단.
11. **[I4] spawn→tile 상관** — 결과 tabId를 클라이언트가 `createTab` 반환값으로 관련 셋에 등록(프로토콜 변경 불요, §6.6).
12. **[I5] 헤드리스 실행 컨텍스트** — PATH/인증 패리티 위해 로그인 셸 경유(§6.2/§9).

**결론:** 두 기능은 기존 뷰/터미널/WS 구조와 정합한다. 교차검증(2026-07-15)으로 §7.3 자체검토가 놓친 2차 구멍(I1)과 §6.5↔§6.8 모순(I2)을 보정했다. `terminal:spawnDirect`는 "구조적 갭"이 아니라 기존 `resumeExternal` 패턴의 이벤트 1개 배선이다(I3). spawn 상관(I4)·실행 컨텍스트(I5)도 명세에 반영. 스프레드→자비스 의존 순서는 순방향이라 순환 없음.

---

## 8. 구현 순서 (제안)

1. **Phase 1 — 스프레드 뷰**: 뷰 추가 + 래퍼 grid/scale/라벨/승격 + 엣지(빈/1개/과다/exited). 순수 프론트, 서버 변경 없음. 독립 출시 가치 있음.
2. **Phase 2 — 자비스 프로토콜 + 브레인 골격**: `concierge:*` 메시지, `conciergeAgent.ts`(오라클 읽기 + 답변만, 액션 없이). 대화 패널 최소 버전.
3. **Phase 3 — 자비스 디스패치**: `terminal:spawnDirect` 플럼빙 + 액션 4종(spawn/focus/resume/send) + 가드레일 + 액션 카드.
4. **Phase 4 — 자비스 합성 뷰**: 미니 타일(스프레드 재사용, 필터) + 픽셀 오피스 배치 + 레이아웃 확정(목업).

각 Phase는 별도 스펙/플랜으로 세분화 가능(brainstorming → writing-plans 사이클).

---

## 9. 미결정 / 후속에서 확정할 것

- 브레인 실체: 헤드리스 `claude -p`(기본값) vs Anthropic API 직접. 입출력 계약(§6.4) 고정 후 선택.
- 자비스 레이아웃 세부(패널 비율·타일 위치): 목업으로 확정.
- 스프레드 타일 상한 수치(스크롤 vs "+N more").
- 초기 프롬프트: 프리필 기본 확정 여부(자동 제출 옵션 제공할지).
- 브라우저 지원 범위(스케일 타일 성능은 xterm 개수에 비례 — 상한과 연관).
- 헤드리스 브레인 실행 컨텍스트(I5): 로그인 셸 경유(`$SHELL -l -c`)로 PATH/인증 상속을 확정할지, `child_process` 직접 실행 + env 주입으로 갈지.

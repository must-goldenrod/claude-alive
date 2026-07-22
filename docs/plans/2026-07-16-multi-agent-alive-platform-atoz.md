# 멀티 에이전트 Alive 웹 플랫폼 개발기획서 A–Z

- 작성일: 2026-07-16
- 대상 저장소: 루트 제품 버전 `claude-alive` v0.5.9 (`package.json` 기준). Workspace package는 `@claude-alive/*` v0.1.0, `@think-prompt/*` v0.6.0으로 독립 버전
- 문서 상태: 제품·기술 통합 기획 초안 v1.2 (2차 교차검증 반영)
- 가칭: **Alive Workspace** (최종 제품명은 별도 결정)
- 핵심 대상: Claude Code, OpenAI Codex, Hermes Agent, 이후 ACP/구조화 API를 제공하는 에이전트

---

## A. 문서의 결론

`claude-alive`를 여러 에이전트의 두뇌를 다시 구현하는 무거운 오케스트레이터로 만들지 않는다. 각 도구가 이미 잘하는 추론, 도구 호출, MCP 연결, 권한 처리, 세션 관리는 가능한 한 그대로 사용한다. Alive는 그 위에 얇은 **로컬 우선 웹 워크스페이스**를 제공한다.

Alive가 책임질 것은 다음 다섯 가지다.

1. Claude/Codex/Hermes의 서로 다른 이벤트를 공통 세션·실행·에이전트 모델로 정규화한다.
2. 터미널, 에이전트 상태, 승인 요청, 결과물, 비용·토큰을 한 화면에서 관찰하고 조작한다.
3. 사용자가 만든 Spread 레이아웃, 필터, 프로젝트, 세션, 결과 요약과 캐시를 안정적으로 복원한다.
4. 사용자가 자리를 비워도 작업이 계속되도록 백그라운드 실행·알림·결과 Inbox를 제공한다.
5. Efficio를 공급자 간 비교가 가능한 “효율성 관찰 계층”으로 확장하되, 근거가 약한 단일 점수로 사용자를 오도하지 않는다.

가장 중요한 구현 결정은 **Provider Adapter + Append-only Event Log + Projection UI**다. 에이전트마다 어댑터가 네이티브 프로토콜을 받아 공통 이벤트로 바꾸고, 서버는 이벤트를 먼저 영속한 뒤 UI용 읽기 모델을 만든다. 터미널 파싱은 구조화 프로토콜이 없는 경우에만 보조 수단으로 쓴다.

---

## B. 제품 정의

### B.1 한 문장 정의

> Alive Workspace는 여러 코딩 에이전트의 실행 화면, 상태, 승인, 결과, 비용과 효율을 사용자가 원하는 레이아웃으로 모아 보고 운영하는 로컬 우선 웹 워크스페이스다.

### B.2 해결하려는 문제

- 에이전트마다 터미널, 세션 목록, 권한 UX, 로그 형식이 달라 병렬 작업 전체를 보기 어렵다.
- 터미널이 늘어나면 “무엇이 실행 중인지, 무엇이 멈췄는지, 어디에 답해야 하는지”를 놓친다.
- 브라우저 새로고침, 서버 재시작, 노트북 절전 후 레이아웃과 작업 맥락이 끊긴다.
- 토큰과 비용은 보이지만 실제로 유효한 결과를 냈는지는 알기 어렵다.
- 사용자는 계속 화면을 지켜보는 대신 쉬거나 다른 일을 하고, 필요한 결정 때만 개입하고 싶다.

### B.3 제품 포지션

Alive는 다음 제품이 아니다.

- 새로운 범용 에이전트 프레임워크
- 모든 모델 호출을 중계하는 LLM Gateway
- 모든 MCP 요청을 대신 실행하는 중앙 MCP Host
- 여러 공급자의 대화 기억을 임의로 섞는 메타 에이전트
- 완전 무인·무제한 자동 실행 시스템

Alive는 **관찰(Observe) → 개입(Intervene) → 복원(Resume) → 검토(Review)** 흐름에 집중한다.

---

## C. 제품 원칙

1. **Native-first**: 공급자의 공식 구조화 인터페이스가 있으면 그것을 사용한다.
2. **Terminal-always**: 구조화 API가 없어도 PTY 기반 터미널로 실행·표시는 가능해야 한다.
3. **Thin orchestration**: 계획·추론은 공급자 에이전트에 맡기고 Alive는 명시적인 세션 작업만 조율한다.
4. **Local-first**: 원문 프롬프트, 터미널 출력, 코드 경로, 토큰 기록은 기본적으로 로컬에 저장한다.
5. **Provider truth preserved**: 공통 상태와 함께 공급자의 원본 상태·원본 이벤트 참조를 보존한다.
6. **User in control**: 승인 정책은 약화하지 않고 공급자의 승인 흐름을 UI에 전달한다.
7. **Graceful degradation**: 토큰·도구·서브에이전트 정보가 없는 공급자도 터미널 세션으로 동작한다.
8. **Explainable efficiency**: Efficio 점수는 구성 요소, 신뢰도, 누락 데이터와 함께 보여준다.
9. **Restful operation**: 사용자가 상시 감시하지 않아도 필요한 순간과 최종 결과만 확실히 전달한다.
10. **No silent loss**: 이벤트 유실, 어댑터 단절, 캐시 만료, 세션 복원 실패를 숨기지 않는다.

---

## D. 현재 구현 자산과 간극

### D.1 재사용 가능한 자산

| 영역 | 현재 자산 | 활용 판단 |
|---|---|---|
| 실시간 상태 | Claude Code 공식 30종 중 현재 17종 등록 → HTTP → SessionStore/전이 함수 → WebSocket | 공통 이벤트 입력의 첫 번째 어댑터로 전환하고 coverage 명시 |
| 터미널 | 서버 소유 `node-pty`, 다중 구독, scrollback, attach/restore | 공급자 중립 `RuntimeTerminalManager`로 일반화 |
| 세션 복원 | managed session registry, Claude resume ID | 공급자별 `ResumeStrategy`로 확장 |
| UI | UnifiedView, Pixel Office, List, Prompt, Efficio | 공통 Projection을 읽도록 타입 변경 |
| Spread View | 다중 live xterm, 포커스, 리사이즈, swap, 단축키, localStorage | 핵심 Workbench 뷰로 승격 |
| 결과 알림 | waiting/error 알림, 소리, 완료 로그 | Notification Center와 Result Inbox로 확장 |
| 효율 분석 | Efficio SQLite, 4축 프로파일, 캐시 효율, 리포트 | provider/model 차원을 추가해 교정 |
| 프롬프트 분석 | prompt-core/worker/agent/rules | 선택형 품질 분석 기능으로 유지 |
| i18n | EN/KO i18next | 신규 UI 전체 동일 규칙 적용 |

### D.2 Claude에 결합된 지점

- 패키지명과 환경 변수: `@claude-alive/*`, `CLAUDE_ALIVE_*`
- 이벤트 타입: `HookEventName`, `HookEventPayload`가 Claude Hook 명세를 직접 표현
- 세션 모델: `AgentInfo.lastEvent`, transcript path, Claude UUID 중심
- 터미널 모델: `mode: 'claude' | 'shell'`, `claudeVariant`
- 실행기: `ClaudeTerminal`, `buildClaudeCommand`
- 복원 저장소: `claudeSessionId`, `claudeVariant`
- 수집기: Claude transcript 직접 파싱 및 세션 종료 Hook 의존
- UI 문구·탭 생성: Claude/Claude Agents 선택이 1급 개념

`buildClaudeCommand`는 추정 자산이 아니라 `packages/server/src/claudeTerminal.ts:89`에 실제 export되어 있으며 `packages/server/src/__tests__/buildClaudeCommand.test.ts`가 root/agents variant, session ID, resume, display name, permission flag를 검증한다. Claude Adapter 추출 시 이 함수와 테스트를 함께 이동하거나 기존 모듈에서 재-export한다.

현재 `/api/event` route와 payload normalization은 `packages/server/src/httpRouter.ts:189`에 있고, 실제 SessionStore/Prompt/WS 처리를 하는 `onEvent` callback은 `packages/server/src/index.ts`에서 주입된다. 두 파일은 ingress와 processing 책임을 나눠 가진다.

현재 상태 머신은 `AgentFSM` class가 아니다. `packages/core/src/state/agentFSM.ts`의 `TRANSITIONS` table과 `transition(currentState, event, toolName)` 함수다. 본 문서에서 FSM은 이 함수형 전이 로직을 지칭한다.

`ViewMode` union에는 `'jarvis'`가 있고 EN/KO label도 있으나 HeaderBar `VIEW_MODES`와 App renderer에는 연결되지 않았다. 따라서 Jarvis는 현재 제공 view가 아니라 **미완성 dormant mode**다. P0에서 (a) 기존 Jarvis 설계를 후속 Work 기능으로 연결하거나 (b) union/i18n dead entry를 제거하는 결정을 내린다.

### D.3 지금 하지 말아야 할 리팩터링

- 첫 단계에서 npm scope와 모든 파일명을 한꺼번에 바꾸지 않는다.
- SessionStore를 제거한 뒤 새 저장소를 만드는 빅뱅 전환을 하지 않는다.
- Claude Hook 입력을 즉시 공통 API로 깨뜨리지 않는다.
- Codex/Hermes를 화면 문자열 정규식만으로 완전 지원했다고 선언하지 않는다.

기존 `/api/event`와 현재 WebSocket protocol을 호환 계층으로 유지하고, 내부에서 versioned v2 공통 이벤트로 변환한다. 현재 `WSServerMessage` 자체에는 `v1` marker가 없으며, 이 문서의 “v1/legacy”는 migration 구분을 위한 명칭이다.

### D.4 요청 흐름에 대한 구현 가능성 검토

결론부터 말하면 **로컬 서버 → 웹 대시보드 → Local/SSH 연결 → 프로젝트 → 세션 → 대화 → 다양한 뷰** 흐름은 현재 자산을 유지하면서 구현할 수 있다. 다만 기능별 구현 가능 범위가 다르다.

| 요구사항 | 현재 상태 | 구현 가능성 | 필요한 핵심 작업 |
|---|---|---|---|
| 로컬 서버와 웹 대시보드 | 이미 제품의 기본 흐름 | 매우 높음 | 기존 포트·CLI·정적 UI 제공 유지 |
| Local/SSH 터미널 생성 | 이미 지원 | 매우 높음 | `location`과 `provider` 모델 분리 |
| Root/Repo 자동 식별 | cwd basename 중심 | 높음 | Git root/remote 탐지와 canonical workspace ID |
| 프로젝트 아래 세션 목록 | live/dormant 일부 제공 | 높음 | 서버 소유 Session Catalog로 통합 |
| 첫 질문 기반 세션 제목 | live agent의 `lastPrompt`, Claude session preview 일부 존재 | 높음 | first prompt 고정 저장, 제목 정책과 수동 변경 |
| 세션 클릭 시 대화 열람 | xterm scrollback/Claude 원본 transcript가 분리됨 | 공급자별로 가능 | 공통 Conversation Reader와 paginated message store |
| Animation/List/Spread의 동일 세션 표시 | 부분적으로 selectedSessionId 공유 | 높음 | 공통 Selection Model과 Projection 단일화 |
| SSH 원격 에이전트 구조화 상태 | 현재는 출력 activity 정도 | 조건부 | 원격 adapter/companion 또는 SSH stdio tunnel |
| 서버 재시작 후 전체 복원 | Claude local 일부만 가능 | 중간 | provider별 resume와 서버 DB 기반 layout/session 저장 |
| 브라우저를 닫은 동안 계속 실행 | 서버와 PTY가 살아 있으면 가능 | 높음 | 현재 server-owned PTY 유지 |
| PC 절전/종료 중 계속 실행 | 로컬 서버만으로 불가능 | 별도 배포 필요 | SSH 원격 daemon 또는 상시 실행 호스트 |

여기서 가장 중요한 사실은 **Local/SSH는 에이전트 종류가 아니라 실행 위치(transport/location)** 라는 점이다. Claude/Codex/Hermes는 어느 위치에서도 실행될 수 있다. 현재처럼 `source: local | ssh`와 `mode: claude | shell`만으로 표현하면 향후 `SSH에서 Codex`, `로컬 Hermes`, `SSH의 일반 shell`을 일관되게 분류할 수 없다.

따라서 다음 세 축을 독립적으로 저장해야 한다.

```text
Execution Location: local | ssh | container | remote-runtime
Agent Provider:     claude | codex | hermes | generic-terminal
Workspace:          root path + git repository identity
```

또한 “세션을 클릭하면 대화가 보인다”는 요구는 단순 xterm scrollback 복원과 다르다. 터미널 출력은 화면 렌더링 기록이고, 대화 이력은 user/assistant/tool/approval 항목의 구조화된 기록이다. 두 데이터를 분리한 뒤 세션 상세 화면에서 함께 제공해야 한다.

---

## E. 목표 사용자와 핵심 시나리오

### E.1 주요 사용자

- 여러 저장소에서 2~10개의 코딩 에이전트를 동시에 돌리는 개인 개발자
- Claude와 Codex를 작업 성격에 따라 번갈아 쓰는 개발자
- 로컬·SSH·컨테이너 환경을 한 화면에서 운영하는 파워 유저
- 토큰/비용보다 “얼마나 적은 낭비로 결과를 냈는가”를 추적하려는 사용자

### E.2 MVP 시나리오

1. 사용자가 프로젝트를 열고 Claude/Codex/Hermes 중 설치된 런타임을 선택해 세션을 시작한다.
2. 세 세션이 Spread View에 타일로 나타나고, Pixel/List 뷰에는 공급자 배지와 공통 상태가 표시된다.
3. 한 에이전트가 승인을 요구하면 전체 화면과 OS 알림에서 우선순위가 올라간다.
4. 사용자는 해당 타일에 답하거나 공급자 네이티브 승인 버튼으로 결정한다.
5. 브라우저를 닫아도 서버 소유 프로세스는 계속되고, 재접속 시 출력·상태·레이아웃이 복원된다.
6. 완료된 작업은 Result Inbox에 요약, 변경 파일/커밋/테스트, 비용·토큰, Efficio 프로파일과 함께 쌓인다.
7. MCP가 필요한 작업은 선택한 런타임의 기존 MCP 설정을 이용하고, Alive는 연결 상태와 실패 이유를 보여준다.

### E.3 후속 시나리오

- 작업 템플릿을 저장해 여러 공급자에 같은 목표를 실행하고 결과를 나란히 비교
- 로컬과 SSH/컨테이너 세션을 하나의 프로젝트 보드로 묶기
- Quiet Mode에서 승인만 즉시 알리고 나머지는 완료 Digest로 모으기
- 세션을 다른 공급자로 “전환”할 때 원 대화를 강제 이식하지 않고, 명시적 Handoff Pack을 생성

---

## F. 정보 구조와 화면 설계

### F.1 보존해야 할 표준 사용자 흐름

제품의 기본 진입 흐름은 바꾸지 않는다.

```text
1. 사용자가 로컬에서 Alive 서버 실행
2. 브라우저가 대시보드 주소를 열거나 사용자가 주소로 접속
3. Local 또는 저장된 SSH 연결 선택
4. Root folder/Repository 선택
5. Claude/Codex/Hermes/Shell 중 런타임 선택
6. 새 세션 시작 또는 과거 세션 재개
7. 메인 프레임에서 세션 대화·상태·터미널 확인
8. Animation/List/Spread 레이아웃을 자유롭게 전환
9. Prompt/Efficio/Usage/Connections 등 관리 화면에서 축적 데이터 확인
```

`claude-alive start`와 기본 로컬 주소, 단일 서버가 UI·HTTP·WebSocket·PTY를 함께 제공하는 구조를 유지한다. 신규 사용자가 별도 database나 cloud account를 먼저 설정하도록 만들지 않는다.

서버가 살아 있는 동안 브라우저를 닫아도 작업은 계속된다. 단, 로컬 PC가 절전·종료되면 로컬 프로세스도 멈춘다. 그 상황에서도 계속 실행하려면 SSH 대상에 Alive companion을 실행하거나 원격 상시 실행 서버를 사용하는 별도 모드가 필요하다.

### F.2 사용자에게 보이는 구조 계층

메인 프레임의 탐색 계층을 다음 하나로 고정한다.

```text
Location
└── Workspace / Repository
    └── Session
        ├── Conversation
        ├── Terminal
        ├── Agents / Subagents
        ├── Approvals
        └── Result / Artifacts
```

#### Location

- `This Mac` 또는 사용자가 지정한 로컬 장치명
- SSH preset의 표시명(예: `GPU Server`, `Staging VM`)
- 상태: online / reconnecting / auth-required / offline
- Location은 물리·실행 위치이며 Claude/Codex/Hermes와 독립적이다.

#### Workspace / Repository

- 표시 우선순위: 사용자 지정명 → Git repository 이름 → root folder basename
- 보조 정보: root path, git branch, dirty 상태, remote host/repository
- Git 저장소가 아니어도 folder workspace로 정상 동작
- 동일 repo의 local clone과 SSH clone은 기본적으로 별도 Workspace이며, 사용자가 원하면 같은 Repository Group으로 묶을 수 있음

#### Session

- 하나의 지속 가능한 대화/작업 단위
- provider, location, workspace, terminal과 연결
- live/dormant/completed/external 상태를 가짐
- 같은 세션이 Animation/List/Spread에서 중복 객체로 생성되지 않고 동일 `sessionId`를 공유

#### Conversation

- user/assistant/reasoning summary/tool/approval/system-result 항목의 시간순 스트림
- raw terminal output과 분리
- 클릭 즉시 읽기 가능하고, 재개는 별도 명시적 동작
- 긴 이력은 cursor pagination과 가상 스크롤 사용

### F.3 메인 프레임

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Header: Work / Data · Layout selector · Global status · Settings    │
├──────────────────┬──────────────────────────────────┬───────────────┤
│ Workspace Tree   │ Main Session Surface             │ Inspector     │
│                  │                                  │               │
│ ▾ This Mac       │ Conversation / Terminal          │ Status        │
│   ▾ repo-a       │ or Animation / List / Spread     │ Usage         │
│     ● session A  │                                  │ Artifacts     │
│     ◐ session B  │                                  │ Approvals     │
│ ▾ GPU Server     │                                  │               │
│   ▾ repo-b       │                                  │               │
└──────────────────┴──────────────────────────────────┴───────────────┘
```

#### 왼쪽: Workspace Tree

- Location → Workspace → Session 계층을 기본으로 표시
- 각 단계 접기/펼치기와 개수·상태 badge
- Session 행에 provider icon, 상태, 제목, 마지막 활동 시간 표시
- 검색 대상: 제목, repo, cwd, provider, 첫 질문
- 필터: live / waiting / completed / dormant, local / SSH, provider
- `+`는 현재 선택한 Location/Workspace 문맥을 이어받아 세션 생성

#### 중앙: Main Session Surface

- 세션 하나를 클릭하면 기본적으로 **Conversation + 입력창**이 열린다.
- 터미널 원문이 필요하면 같은 세션의 Terminal 탭으로 전환한다.
- Animation/List는 현재 범위(Location/Workspace/전체)의 세션 상태를 표현한다.
- Spread는 선택된 여러 세션의 live terminal을 동시에 표현한다.
- 레이아웃을 바꿔도 `selectedSessionId`, scope, filters, scroll anchor를 유지한다.

#### 오른쪽: Inspector

- 현재 세션의 provider/model/location/cwd/branch
- 현재 tool, 경과시간, token/cache/cost
- pending approval와 질문
- 변경 파일, diff, 테스트, 결과 artifact
- Efficio 요약과 측정 confidence

Inspector는 접을 수 있으며 작은 화면에서는 drawer가 된다.

### F.4 상위 내비게이션: Work와 Data 분리

Animation/List/Spread는 서로 다른 제품 메뉴가 아니라 같은 운영 데이터를 보여주는 **Work 레이아웃**이다. Prompt와 Efficio는 실행 화면이 아니라 축적 데이터를 분석하는 **Data 메뉴**다.

| 상위 영역 | 하위 화면 | 목적 |
|---|---|---|
| **Work** | Conversation, Terminal, Animation, List, Spread | 세션 생성·대화·관찰·개입 |
| **Results** | Inbox, Artifacts, Reviews | 완료 결과 검토와 후속 작업 |
| **Data** | Prompt, Efficio, Usage, Cache | 프롬프트·효율·비용·캐시 분석 |
| **Connections** | Runtime, SSH, MCP, Doctor | 설치·인증·연결 상태 관리 |
| **Settings** | UI, Notifications, Storage, Privacy | 제품 환경 설정 |

현재 HeaderBar의 `animation/list/prompt/efficio/spread` 평면 탭은 점진적으로 다음처럼 바꾼다.

```text
1차: 기존 탭 유지 + Work/Data 시각 그룹
2차: Work 진입 후 내부 Layout selector로 Animation/List/Spread 이동
3차: Prompt/Efficio를 Data 하위 route로 이동
```

### F.5 Workspace/Repository 식별 규칙

로컬에서는 새 세션 생성 전에 다음 read-only 탐지를 실행한다.

1. `git rev-parse --show-toplevel` 성공 시 실제 git root 사용
2. `git remote get-url origin`이 있으면 remote URL 정규화
3. repo name은 remote의 마지막 path segment에서 `.git` 제거
4. Git이 아니면 선택한 cwd를 root로 사용하고 basename을 이름으로 사용
5. 사용자의 custom name이 있으면 항상 표시 우선

SSH에서도 같은 탐지를 원격 명령으로 실행하되 다음 원칙을 지킨다.

- 연결 직후 임의 디렉터리를 전체 탐색하지 않음
- 사용자가 선택한 cwd에서만 read-only probe
- timeout과 실패 원인을 표시
- remote URL의 credential/userinfo는 저장 전에 제거

권장 identity는 다음과 같다.

```ts
interface WorkspaceIdentity {
  workspaceId: string;
  locationId: string;
  rootPath: string;
  kind: 'git' | 'folder';
  displayName: string;
  customName?: string;
  repo?: {
    remoteUrlNormalized?: string;
    host?: string;
    owner?: string;
    name: string;
  };
}
```

경로만으로 workspace를 식별하면 local과 SSH의 같은 문자열 경로가 충돌하므로 `(locationId, canonicalRootPath)`를 기본 key로 사용한다.

### F.6 세션 제목 정책

현재는 프로젝트명이 agent/tab 이름 역할까지 겸해 같은 프로젝트의 여러 세션을 구분하기 어렵다. 앞으로 Workspace 이름과 Session 제목을 분리한다.

제목 source 우선순위:

```text
manual title
→ provider-native title
→ first meaningful user prompt에서 자동 생성
→ “새 세션 · HH:mm” fallback
```

자동 제목 규칙:

1. 첫 번째 실제 사용자 프롬프트를 한 번만 캡처해 `firstPrompt`로 저장
2. 줄바꿈과 연속 공백을 한 칸으로 정규화
3. secret redaction 적용
4. 앞뒤 인용부호와 의미 없는 CLI control command 제거
5. 기본 10개 grapheme cluster를 사용하고 길면 `…` 추가
6. 한글 조합문자와 emoji가 중간에 잘리지 않도록 `Intl.Segmenter` 사용
7. 제목 생성 뒤 후속 프롬프트가 와도 자동으로 바꾸지 않음
8. 사용자가 바꾼 제목은 `titleSource: manual`로 고정

리스트의 좁은 행에는 10자 제목을, 카드/Inspector에는 최대 80자의 `firstPromptPreview`를 함께 표시한다. 전체 첫 프롬프트는 권한과 privacy 설정이 허용된 경우에만 tooltip/상세에서 보여준다.

```ts
interface SessionTitle {
  title: string;
  titleSource: 'manual' | 'provider' | 'first-prompt' | 'fallback';
  firstPrompt?: string;
  firstPromptPreview?: string;
  generatedAt: number;
  updatedAt: number;
}
```

### F.7 세션 클릭과 대화 노출

세션 클릭은 실행/재개와 분리한다.

- **live session**: 저장된 대화 이력을 즉시 열고 입력 가능
- **dormant resumable session**: 대화 이력을 read-only로 열고 `Resume` 버튼 제공
- **completed session**: 대화·결과 read-only, `Continue`로 새 run 시작
- **external session**: 관찰 가능한 이력을 먼저 열고, `Attach/Resume here`를 명시적으로 선택
- **history unavailable**: 빈 화면 대신 “이 공급자/연결에서는 구조화 대화 이력을 읽을 수 없음”과 Terminal scrollback 버튼 표시

공급자별 history source:

| Provider | 1순위 | 2순위 | 기대 수준 |
|---|---|---|---|
| Claude | Hook으로 받은 message + JSONL transcript | server scrollback | user/assistant/tool 이력 가능 |
| Codex | app-server thread/read·item events | TUI scrollback | 구조화 이력과 상태 가능 |
| Hermes | gateway session.history | TUI scrollback | 구조화 이력 가능 |
| Generic terminal | 없음 | scrollback | 터미널 기록만 제공 |
| SSH provider | 원격 adapter/stdio tunnel | 로컬 PTY scrollback | bridge 유무에 따라 다름 |

Conversation item은 공급자 원문을 억지로 같은 텍스트로 평탄화하지 않는다.

```ts
type ConversationItem =
  | UserMessageItem
  | AssistantMessageItem
  | ToolCallItem
  | ApprovalItem
  | ArtifactItem
  | SystemEventItem;
```

도구 출력과 reasoning은 기본 접힘, 사용자·최종 assistant 메시지는 기본 펼침으로 두어 긴 세션도 읽기 쉽게 한다. 터미널 escape sequence를 conversation HTML로 직접 렌더하지 않는다.

### F.8 Workbench와 레이아웃 의미

- **Conversation**: 한 세션의 대화와 입력에 집중
- **Terminal**: 한 세션의 raw TUI/shell 직접 조작
- **Animation**: scope 안의 세션/에이전트를 픽셀 캐릭터로 표현
- **List**: scope 안의 세션/에이전트를 정보 밀도 높게 표현
- **Spread**: 사용자가 pin한 terminal들을 동시 조작

Animation/List/Spread는 독립적인 session store를 갖지 않는다. 모두 `WorkspaceProjection`, `SessionProjection`, `SelectionState`를 공유한다. 어떤 뷰에서 세션을 클릭해도 같은 중앙 Conversation/Terminal surface로 이동하거나 focus한다.

Spread tile의 source 표시는 다음처럼 분리한다.

```text
[SSH: GPU Server] [Codex] fix-auth-flow…
[Local]           [Claude] 테스트 실패 원…
```

즉 SSH badge와 Claude/Codex badge가 서로 대체 관계가 아니다.

### F.9 Result Inbox

결과는 단순 “완료 로그”보다 강한 1급 객체다.

- 상태: needs-review / accepted / needs-follow-up / archived
- 내용: 최종 답변, 변경 파일, diff 링크, 커밋, 테스트 결과, 생성 산출물
- 실행 정보: 공급자, 모델, 프로젝트, 시작/종료, 총 시간, 토큰, 비용
- 품질 정보: 오류/재시도, 사용자 개입 횟수, Efficio 축, 측정 신뢰도
- 후속 동작: 대화 열기, 터미널 열기, 세션 재개, 후속 프롬프트, 다른 공급자에게 Handoff

### F.10 Data 하위 메뉴

- **Prompt**: 현재 prompt-core의 품질·분류·세션 drill-down
- **Efficio**: 낭비 잔차, cache 효율, 프로젝트/공급자 비교
- **Usage**: provider/model별 token, cost, 시간
- **Cache**: cache read/create, hit ratio, 절감 추정
- **Storage**: session/transcript/scrollback 보존량과 정리

모든 Data 화면은 Workspace와 Session으로 되돌아가는 링크를 제공한다. 예를 들어 Efficio의 한 점을 클릭하면 해당 Session Conversation과 Result를 열 수 있어야 한다.

### F.11 Quiet Mode와 알림

| 이벤트 | 기본 처리 |
|---|---|
| 승인/질문 필요 | 즉시 OS 알림 + 화면 강조 + 선택적 소리 |
| 오류/연결 단절 | 즉시 알림, 자동 재시도 여부 표시 |
| 정상 완료 | Inbox 적재 + 묶음 알림 |
| 진행 로그 | 화면 내 스트림만, OS 알림 없음 |
| 자원 임계치 | 지속 시간 조건을 만족할 때만 알림 |

사용자가 쉬는 동안 동작하는 것은 “무제한 자율 실행”이 아니라, 이미 승인된 런타임과 정책 안에서의 **백그라운드 지속 실행 + 정확한 결과 전달**이다.

### F.12 i18n 작업량과 키 계획

현재 `en.json`, `ko.json`은 각각 375개 leaf key를 가지고 있다. 신규 정보 구조는 단순 탭 이름 몇 개가 아니라 상태, 빈 화면, 오류, capability 제한, 확인 dialog, 접근성 label을 포함하므로 P4의 한 줄짜리 번역 작업으로 처리할 수 없다.

초기 추정은 locale당 **신규 140~190개 key**, 총 280~380개 번역 값이다. 디자인 확정 전에 정확한 수량을 commitment로 사용하지 않고 namespace별 budget으로 관리한다.

| namespace | 예상 key/locale | 내용 |
|---|---:|---|
| `navigation` | 8~12 | Work/Results/Data/Connections와 layout |
| `locations` | 14~20 | Local/SSH/container 상태, 재연결, 인증 |
| `workspaces` | 14~20 | repo/folder probe, branch, rename, 오류 |
| `sessions` | 24~32 | title source, lifecycle, resume/history capability |
| `conversation` | 20~28 | item 종류, load more, history unavailable, input |
| `inspector` | 12~18 | status/usage/artifact/approval 영역 |
| `results` | 18~24 | review 상태와 후속 동작 |
| `connections` | 20~28 | runtime/MCP/doctor 상태와 action |
| `data` | 8~12 | Prompt/Efficio/Usage/Cache/Storage navigation |
| `common` 추가 | 8~12 | empty/error/loading/unsupported/a11y |

규칙:

- React UI 문자열뿐 아니라 canvas, aria-label, tooltip, toast, confirm dialog도 key를 사용한다.
- `defaultValue`로 영문 fallback을 하드코딩하지 않는다.
- provider raw error는 번역하지 않고, 번역된 분류 메시지 아래 접을 수 있는 원문으로 표시한다.
- plural과 상대시간은 i18next interpolation 규칙을 따른다.
- title 10자 절단은 번역 문자열이 아니라 사용자 prompt에만 적용한다.
- EN/KO key parity, 미사용 key, raw JSX text를 CI에서 검사한다.

i18n은 P4 말미 작업이 아니다. 각 Epic의 UI acceptance criteria와 PR definition of done에 포함하고, P0에서 namespace와 parity checker를 먼저 추가한다.

---

## G. 목표 아키텍처

```text
Claude Hooks ─┐
Codex app-server ─┼─> Provider Adapters ─> Canonical Event Bus ─> Event Log (SQLite)
Hermes Gateway ──┤                                  │
PTY fallback ────┘                                  ├─> Live Projections ─> WebSocket v2 ─> Web UI
                                                    ├─> Result Builder
                                                    ├─> Notification Policy
                                                    └─> Efficio Collector

Web UI ─> Session Commands ─> Runtime Supervisor ─> Provider Adapter / PTY
                                  │
                                  └─> native approvals, resume, interrupt, MCP status
```

### G.1 주요 계층

1. **Runtime Supervisor**: 프로세스 생명주기, PTY, 재시작, attach, health check
2. **Provider Adapter**: 네이티브 프로토콜 ↔ 공통 명령/이벤트 변환
3. **Canonical Event Bus**: 순서, 중복 제거, 스키마 버전, backpressure
4. **Event Store**: 원본 이벤트 참조와 정규화 이벤트 영속
5. **Projection Store**: UI가 빠르게 읽는 세션·에이전트·승인·결과 상태
6. **Web Gateway**: HTTP command API + WebSocket snapshot/delta
7. **Analysis Workers**: transcript/token/result/Efficio 비동기 처리

### G.2 권장 패키지 구조

현재 workspace는 총 **11개 패키지**이며, 그중 prompt 서브시스템은 7개가 아니라 다음 **5개**다.

```text
@think-prompt/core
@think-prompt/rules
@think-prompt/agent
@think-prompt/worker
@think-prompt/cli-internal
```

나머지는 `core`, `server`, `ui`, `hooks`, `i18n`, `cli` 6개다. 현재 `pnpm-workspace.yaml`은 `packages/*` 한 단계만 인식하므로 `packages/adapters/claude` 같은 중첩 경로를 바로 추가하면 workspace에서 누락된다. 따라서 아래 구조는 최종 논리 구조이며, 초기 migration은 기존 패키지를 보존하는 **additive flat layout**으로 진행한다.

#### 1단계: 실제로 적용할 평면 구조

```text
packages/
├── core/                  # 기존, provider-neutral contract를 점진 수용
├── runtime/               # 신규
├── storage/               # 신규
├── adapter-claude/        # 신규; hooks/CLI/transcript 조합 계층
├── adapter-codex/         # 신규
├── adapter-hermes/        # 신규
├── adapter-terminal/      # 신규
├── server/                # 기존 composition root
├── ui/                    # 기존
├── hooks/                 # 기존 Claude 설치 호환 패키지
├── i18n/                  # 기존
├── cli/                   # 기존
├── prompt-core/           # 기존 유지
├── prompt-rules/          # 기존 유지
├── prompt-agent/          # 기존 유지, canonical ingest로 전환
├── prompt-worker/         # 기존 유지, analysis worker
└── prompt-cli/            # 기존 호환 CLI; parity 이후 통합/폐기 판단
```

#### 2단계: 필요할 때만 중첩 구조로 정리

```text
packages/
├── core/                  # provider-neutral contracts, IDs, protocol v2
├── runtime/               # process/PTY supervisor, health, resume
├── storage/               # SQLite event log, projections, migrations
├── adapters/
│   ├── claude/            # hooks + CLI + transcript
│   ├── codex/             # app-server JSON-RPC
│   ├── hermes/            # TUI gateway JSON-RPC or ACP
│   └── terminal/          # generic PTY fallback
├── server/                # composition root, HTTP/WS gateway
├── ui/                    # provider-neutral React UI
├── i18n/
└── cli/                   # install/doctor/start/migrate
```

2단계로 이동하려면 `packages/*`에 더해 `packages/adapters/*`, 필요하면 `packages/analysis/*` glob을 추가하고 Turborepo·build-npm·release script가 중첩 패키지를 포함하는지 먼저 검증한다. 폴더 미관만을 위해 이 이동을 P0에서 수행하지 않는다.

#### prompt 서브시스템의 위치와 책임

| 현재 패키지 | migration 중 위치 | 장기 책임 | 결정 |
|---|---|---|---|
| `prompt-core` | 그대로 | prompt DB, schema, scorer, PII, 분석 기반 | P0~P5 이동 없음 |
| `prompt-rules` | 그대로 | 결정론 prompt rule registry | 이동 없음 |
| `prompt-agent` | 그대로 | 현재 Claude Hook ingest + Prompt HTTP API | P1에서 `HookEventPayload` 직접 의존을 canonical `message.user` consumer로 축소 |
| `prompt-worker` | 그대로 | queue 기반 transcript/analysis job | P1~P4 유지, 이후 공통 analysis queue 검토 |
| `prompt-cli` | 그대로 | think-prompt 호환 CLI | Alive CLI에 parity가 생긴 후 별도 deprecation ADR |

Prompt는 삭제되거나 adapter 아래로 들어가지 않는다. 운영 session catalog와 분석 prompt store는 책임이 다르다. 다만 `prompt-agent`가 현재 `HookEventPayload`를 직접 받기 때문에 멀티 provider 분석을 하려면 canonical user-message event consumer를 추가해야 한다. 초기에는 Claude만 분석되는 `coverage: claude-only` 상태를 UI에 표시하고, 분석 범위를 조용히 전체 provider로 오인시키지 않는다.

#### 데이터베이스 소유권

새 operational SQLite를 만들더라도 기존 Prompt DB와 Efficio DB를 즉시 합치지 않는다.

| 저장소 | 소유 데이터 | 쓰기 주체 |
|---|---|---|
| Alive operational DB | location/workspace/session/event/projection/layout/result | `storage` |
| Prompt DB | prompt 원문·규칙·품질 score·queue | `prompt-core/worker` |
| Efficio DB | work unit·axis score·model version | Python Efficio |

세 DB는 `workspaceId/sessionId/runId`로 참조하되 cross-DB transaction을 만들지 않는다. Data 화면은 server read model에서 합성한다. 향후 통합은 retention, migration, Python/Node 동시 쓰기 문제를 해결하는 별도 ADR 없이는 진행하지 않는다.

---

## H. Provider Adapter 계약

### H.1 Capability Matrix

```ts
interface ProviderCapabilities {
  structuredEvents: boolean;
  streamingMessages: boolean;
  toolLifecycle: boolean;
  approvals: 'native' | 'terminal' | 'none';
  tokenUsage: 'live' | 'final' | 'estimated' | 'none';
  subagents: 'full' | 'partial' | 'none';
  resume: 'stable-id' | 'best-effort' | 'none';
  interrupt: boolean;
  steer: boolean;
  mcpInventory: boolean;
  artifacts: boolean;
}
```

UI는 공급자 이름으로 기능을 분기하지 않고 이 capability로 버튼과 설명을 결정한다.

### H.2 Adapter 인터페이스

```ts
interface AgentRuntimeAdapter {
  readonly provider: ProviderId;
  detect(): Promise<RuntimeInstallation>;
  capabilities(): Promise<ProviderCapabilities>;
  start(input: StartSessionInput): Promise<RuntimeSessionHandle>;
  attach(ref: ProviderSessionRef): AsyncIterable<CanonicalEvent>;
  send(sessionId: SessionId, input: UserInput): Promise<void>;
  approve?(request: ApprovalDecision): Promise<void>;
  interrupt?(sessionId: SessionId): Promise<void>;
  resume?(ref: ProviderSessionRef): Promise<RuntimeSessionHandle>;
  close(sessionId: SessionId): Promise<void>;
  health(): Promise<AdapterHealth>;
}
```

### H.3 어댑터별 권장 통합 방식

#### Claude Adapter

- 현재 등록된 17개 Hook 입력을 모두 유지한다.
- CLI/PTY 실행과 stable session ID, resume 흐름을 재사용한다.
- transcript 파싱은 토큰·최종 결과 보강용으로 사용한다.
- Hook HTTP payload를 먼저 `ClaudeRawEvent`로 검증하고 공통 이벤트로 변환한다.
- 한계: Hook이 유실되거나 외부 세션 transcript에 접근하지 못하면 상태 신뢰도가 낮아질 수 있다.

2026-07-16 공식 Claude Code Hook reference에는 30종이 있으며 현재 `packages/hooks/src/install.ts:6–13`은 그중 17종을 등록한다. 따라서 “17개 Hook 지원”은 전체 지원 수가 아니라 **현재 coverage 17/30**이라는 의미다.

현재 미등록 13종:

```text
Setup, UserPromptExpansion, PermissionDenied, PostToolBatch,
MessageDisplay, TaskCreated, StopFailure, InstructionsLoaded,
CwdChanged, FileChanged, PostCompact, Elicitation, ElicitationResult
```

모든 이벤트를 무조건 등록하는 것은 목표가 아니다. 이벤트별 제품 가치와 빈도/비용을 평가한다.

| 우선순위 | 이벤트 | 이유 |
|---|---|---|
| P1 필수 검토 | `StopFailure`, `PermissionDenied`, `PostCompact` | 실패·거부·compaction 완료 상태 정확도 |
| P1/P2 권장 | `TaskCreated`, `PostToolBatch`, `CwdChanged` | 작업 구조, 병렬 tool batch, workspace identity |
| MCP 연동 시 필수 | `Elicitation`, `ElicitationResult` | MCP 사용자 입력 대기/응답 표현 |
| 관측 선택형 | `InstructionsLoaded`, `UserPromptExpansion` | context/prompt provenance |
| opt-in/제한 | `FileChanged`, `MessageDisplay` | 높은 이벤트량 또는 표시 전용 의미 |
| 낮은 우선순위 | `Setup` | 일반 interactive session에서는 발생하지 않음 |

P0에서 `ClaudeHookCoverage` manifest를 만들고 `registered`, `normalized`, `projected`, `ignored-with-reason`을 분리한다. 공식 Hook 목록이 늘어나도 core union이 즉시 깨지지 않도록 unknown raw event를 격리 저장하고 doctor가 version/coverage 차이를 보고한다.

#### Codex Adapter

- 1순위: stdio가 기본인 `codex app-server`의 양방향 JSON-RPC를 자식 프로세스로 관리한다. 현재 version은 `--stdio` alias와 `--listen stdio://`도 지원하지만, default invocation이 version 호환에 가장 단순하다.
- `thread/start|resume`, `turn/start|interrupt`, `item/*`, `turn/*`, `thread/tokenUsage/updated`, 서버 주도 승인 요청을 매핑한다.
- 설치된 Codex 버전에서 `generate-json-schema` 또는 `generate-ts`로 스키마를 생성해 adapter 버전과 함께 보관한다.
- 실험적 WebSocket listener가 아니라 안정적인 stdio를 기본 transport로 쓴다.
- TUI 터미널은 사용자가 원할 때 병행 표시하되, 상태의 진실은 app-server 이벤트로 둔다.

**2026-07-16 로컬 Spike 결과:** 설치된 `codex-cli 0.144.5`에서 `codex app-server --help`는 `stdio://`를 기본 transport로 명시하고 `--stdio` alias도 제공했다. `generate-json-schema`와 `generate-ts`가 성공했고 `thread/start|resume|read`, `turn/start|interrupt|steer`, `item/started|completed`, `thread/tokenUsage/updated`, command/file/permission approval request 타입을 생성물에서 확인했다. 실제 `initialize` 요청과 `initialized` 알림의 stdio handshake도 성공했다.

단, 실제 `thread/start → turn/start → item stream → approval → turn/completed` 전 과정은 아직 실행하지 않았다. 따라서 stdio 선택은 **조건부 채택**이며 P2 시작 시 아래 lifecycle smoke를 통과한 뒤 ADR-004를 Accepted로 올린다.

1. initialize/initialized
2. ephemeral thread/start
3. read-only turn/start
4. item/turn/token notification correlation
5. interrupt
6. thread/read와 resume
7. 승인 요청 1종의 request/response round trip

생성 스키마는 설치 버전에 종속되므로 저장소에 무제한 vendor하지 않는다. 지원 Codex version별 최소 fixture와 schema hash를 adapter test 자산으로 보관하고, 미지원 version은 terminal fallback으로 degrade한다.

#### Hermes Adapter

- 웹/TUI의 전체 기능이 필요하므로 1순위는 TUI Gateway JSON-RPC다.
- 표준화와 구현 단순성이 더 중요하면 ACP를 선택할 수 있으나, capability 차이를 실측한 뒤 결정한다.
- 공식 method catalog에서 확인되는 `session.create/list/active_list/activate/close/interrupt/history/compress/branch/title/usage/status`, `prompt.submit`, `session.steer`와 `message.*`, `tool.*`, `approval.request`를 후보 매핑으로 사용한다.
- OpenAI-compatible HTTP API는 외부 프론트엔드 연결에는 편하지만, 전체 승인·도구 생명주기 표현이 목표라면 보조 경로로 둔다.

Hermes 프로토콜 선택은 아직 확정하지 않는다. ADR-005는 P3의 3일 Spike가 끝나기 전에는 `Pending`이며, Spike 산출물 자체가 ADR의 근거가 된다. P0/P1의 exit gate는 ADR-005에 의존하지 않는다.

**공식 문서 내부 불일치:** 같은 Programmatic Integration 문서의 method catalog에는 `session.resume`이 없고 live switch는 `session.activate`, saved transcript discovery는 `session.list`/`/resume`, tree restore는 `spawn_tree.load`로 설명된다. 그러나 아래 Pi-style mapping 표는 `switch_session → session.resume`이라고 적는다. 따라서 `session.resume`을 구현 계약으로 확정하지 않는다. P3 Spike에서 실제 gateway의 method catalog/오류 응답과 다음 세 흐름을 분리 검증한다.

1. process-local live session 전환: `session.active_list` + `session.activate`
2. 저장 대화 discovery/reopen: `session.list` + 실제 wire method 또는 command dispatch `/resume`
3. spawn tree 복원: `spawn_tree.list/load`

Adapter의 공통 `resume()`은 위 provider-specific 동작을 캡슐화하고, 검증 전에는 capability를 `resume: best-effort`로 보고한다.

#### Generic Terminal Adapter

- 실행 커맨드, cwd, 환경, resume command를 사용자가 프리셋으로 등록한다.
- 상태는 running / waiting-unknown / exited 정도만 확실하게 제공한다.
- ANSI 출력 정규식으로 공급자 내부 상태를 추론하는 기능은 실험 플러그인으로 격리한다.

---

## I. 공통 도메인 모델

### I.1 핵심 객체

| 객체 | 설명 |
|---|---|
| Provider | claude, codex, hermes, terminal 등 런타임 종류 |
| Location | local 장치, SSH host, container 등 실행 위치와 연결 상태 |
| Workspace | Location 안의 canonical root와 repository identity |
| Session | 공급자의 지속 가능한 대화 단위 |
| Run | 한 번의 사용자 목표 수행; Codex의 turn 등에 대응 |
| Agent | 루트·서브에이전트 실행 주체 |
| ToolCall | 도구 시작/진행/완료/실패 |
| Approval | 사용자 결정이 필요한 요청과 응답 |
| Terminal | PTY 인스턴스와 attach/scrollback 메타데이터 |
| Artifact | diff, 파일, 커밋, 테스트, 보고서 등 결과물 |
| UsageSample | 토큰, 캐시, 비용, 지연, 모델 정보 |
| Result | 사용자가 검토할 완료 단위 |
| Connection | runtime/MCP/SSH의 설치·인증·건강 상태 |
| LayoutPreset | Workbench 배치와 필터 |

### I.1.1 세션의 필수 관계

```ts
interface SessionRecord {
  sessionId: string;                 // Alive stable ID
  provider: ProviderId;
  providerSessionId?: string;
  locationId: string;
  workspaceId: string;
  terminalId?: string;
  parentSessionId?: string;
  title: string;
  titleSource: 'manual' | 'provider' | 'first-prompt' | 'fallback';
  firstPromptPreview?: string;
  lifecycle: 'live' | 'dormant' | 'completed' | 'external' | 'failed';
  historyCapability: 'structured' | 'transcript' | 'scrollback-only' | 'none';
  resumeCapability: 'available' | 'process-only' | 'unsupported' | 'unknown';
  createdAt: number;
  lastActiveAt: number;
}
```

이 레코드는 터미널 탭보다 상위에 있다. 사용자가 터미널 탭을 닫아도 Session과 Conversation은 남을 수 있고, 하나의 Session이 dormant가 된 뒤 새 Terminal에 resume될 수 있다. 반대로 일반 shell terminal은 agent session 없이 Terminal만 존재할 수 있다.

### I.2 공통 상태

```ts
type CommonAgentState =
  | 'starting'
  | 'ready'
  | 'thinking'
  | 'using-tool'
  | 'waiting-user'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'disconnected'
  | 'unknown';
```

현재 FSM을 한 번에 교체하지 않고 다음 매핑 계층을 둔다.

```ts
interface NormalizedState {
  common: CommonAgentState;
  providerState: string;
  confidence: 'exact' | 'derived' | 'heuristic';
  reason?: string;
}
```

### I.3 공통 이벤트 Envelope

```ts
interface CanonicalEvent<T = unknown> {
  schemaVersion: 2;
  eventId: string;
  kind: CanonicalEventKind;
  provider: ProviderId;
  source: 'structured' | 'hook' | 'transcript' | 'pty' | 'synthetic';
  sourceEventId?: string;
  workspaceId: string;
  sessionId: string;
  runId?: string;
  agentId?: string;
  seq?: number;
  occurredAt: number;
  receivedAt: number;
  confidence: 'exact' | 'derived' | 'heuristic';
  payload: T;
  rawRef?: string;
}
```

필수 kind는 `session.*`, `run.*`, `agent.*`, `message.*`, `tool.*`, `approval.*`, `usage.updated`, `artifact.created`, `result.ready`, `connection.*`이다.

### I.4 ID 원칙

- Alive 내부 ID는 ULID로 생성한다.
- 공급자 세션 ID는 별도 `providerSessionId`로 보존한다.
- 동일 이벤트 재수신 시 `(provider, providerSessionId, sourceEventId)`로 중복 제거한다.
- sourceEventId가 없으면 제한된 시간창의 content hash를 사용하되 `dedupeConfidence`를 기록한다.

### I.5 서버 소유 Catalog와 UI Projection

현재 open tab은 브라우저 localStorage, managed Claude session은 서버 JSON, live agent는 SessionStore, SSH session은 React state에 각각 존재한다. 이 구조를 유지한 채 계층 UI를 만들면 새로고침과 여러 브라우저 사이에서 목록이 달라진다.

따라서 다음 catalog를 서버 SQLite의 단일 출처로 만든다.

- `locations`
- `workspaces`
- `sessions`
- `session_titles`
- `terminals`
- `conversation_items`
- `session_provider_refs`

UI는 다음 Projection 하나를 구독한다.

```ts
interface WorkspaceTreeProjection {
  locations: Array<{
    location: LocationSummary;
    workspaces: Array<{
      workspace: WorkspaceSummary;
      sessions: SessionSummary[];
    }>;
  }>;
  selectedSessionId?: string;
  cursor: string;
}
```

`selectedSessionId`의 영속 source는 URL route(`/work/sessions/:id`)다. React state는 즉시 반응용 mirror로만 사용한다. 이렇게 하면 새로고침, 뒤로가기, 링크 공유(로컬 범위), Prompt/Efficio drill-down이 같은 세션을 안정적으로 연다.

---

## J. 명령 API와 WebSocket v2

### J.1 Command API

```text
POST /api/v2/sessions
POST /api/v2/sessions/:id/input
POST /api/v2/sessions/:id/approve
POST /api/v2/sessions/:id/interrupt
POST /api/v2/sessions/:id/resume
POST /api/v2/sessions/:id/close
GET  /api/v2/sessions/:id
GET  /api/v2/sessions/:id/conversation?cursor=...
PUT  /api/v2/sessions/:id/title
GET  /api/v2/workspace-tree
POST /api/v2/workspaces/probe
GET  /api/v2/runtime/installations
GET  /api/v2/connections
GET  /api/v2/results
PUT  /api/v2/layouts/:id
```

모든 변경 명령은 `commandId`를 받아 재시도 시 멱등성을 보장한다.

### J.2 WebSocket

- 연결 시 snapshot cursor와 구독 필터를 전달한다.
- 서버는 snapshot 후 cursor 이후 delta만 전송한다.
- 클라이언트는 마지막 ack cursor를 저장하고 재접속 시 재개한다.
- 느린 클라이언트는 bounded queue 초과 시 `resync-required`를 받고 snapshot을 다시 요청한다.
- 터미널 byte stream과 도메인 이벤트는 논리 채널을 분리해 상태 이벤트가 출력 폭주에 밀리지 않게 한다.

### J.3 현재 protocol 호환(문서상 legacy/v1)

- `/api/event`는 Claude Adapter ingress로 유지한다.
- 기존 `WSServerMessage`는 v2 Projection에서 생성하는 compatibility broadcaster로 유지한다.
- UI가 모두 v2로 전환된 다음 한 개 minor release 동안 경고 후 제거한다.

현재 wire type에는 protocol version field나 `v1` marker가 없다. 아래에서 v1은 “현재 unversioned protocol”을 v2 migration과 구분하기 위한 문서상 alias다. `WSServerMessage`는 `packages/core/src/protocol/wsProtocol.ts:32–61` 기준 **20개 variant**다. 호환은 canonical event 하나를 즉석에서 legacy 메시지 하나로 바꾸는 단순 mapper가 아니다. v2 reducer가 먼저 legacy read model에 필요한 상태를 유지하고 compatibility broadcaster가 그 projection을 읽어야 한다.

#### v1 outbound 매핑

| v1 메시지 | v2 source | 호환 방식 |
|---|---|---|
| `agent:spawn` | `agent.started` + session/workspace projection | `AgentInfo` legacy shape 구성 |
| `agent:despawn` | `agent.stopped` | sessionId 역참조 |
| `agent:state` | agent current-state reducer | legacy `AgentState`와 animation mapper |
| `agent:prompt` | `message.user.created` | prompt privacy 정책 적용 후 전달 |
| `agent:rename` | session/workspace title update | 기존 의미가 project/session rename을 섞으므로 Claude v1에 한해 유지 |
| `agent:completed` | `result.ready` | `CompletedSession` legacy projection |
| `event:new` | canonical event log | `EventLogEntry`로 표현 가능한 subset만 변환 |
| `stats:update` | agent/session aggregate reducer | `AgentStats` 재계산 |
| `snapshot` | 아래 legacy snapshot projection | cursor 시점의 일관된 묶음 생성 |
| `system:heartbeat` | server clock | 변경 없이 생성 |
| `system:metrics` | system metrics poller | 변경 없이 전달 |
| `terminal:output` | runtime PTY channel | passthrough; event DB에 매 chunk 저장하지 않음 |
| `terminal:exited` | terminal lifecycle | passthrough + projection update |
| `terminal:ssh-error` | location/terminal connection error | legacy error kind mapper |
| `terminal:restore` | scrollback store | passthrough |
| `terminal:dormant` | session resume projection | Claude stable ID가 있을 때만 생성 |
| `terminal:missing` | attach lookup miss | passthrough |
| `sessions:resumable` | resumable session projection | Claude-compatible subset만 생성 |
| `project:names` | workspace custom-name projection | cwd-keyed legacy map 생성 |
| `efficio:update` | Efficio reader/watcher | 기존 경로 유지 |

#### snapshot 호환 계약

```ts
interface LegacySnapshotProjection {
  agents: AgentInfo[];
  recentEvents: EventLogEntry[];       // 기존과 동일하게 최대 100
  completedSessions: CompletedSession[];
  stats: AgentStats;
  resumableSessions: ResumableSession[];
}
```

- 한 SQLite read transaction/cursor에서 다섯 필드를 만들어 서로 다른 시점이 섞이지 않게 한다.
- v2에만 존재하는 Codex/Hermes 필드를 v1 `AgentInfo`에 억지로 넣지 않는다.
- v1 UI가 이해할 수 없는 provider는 최소 AgentInfo projection으로 표시하거나 feature flag 동안 v2 UI에만 노출한다.
- terminal stream은 domain snapshot과 분리하되 attach 결과의 순서는 `terminal:restore` 후 lifecycle 상태가 되도록 기존 계약을 유지한다.
- `project:names`의 cwd key는 SSH에서 충돌할 수 있으므로 v1은 local Claude에 한정하고 v2는 workspaceId를 사용한다.

#### 검증

1. 현재 v1 snapshot fixture를 golden file로 고정
2. 같은 Claude Hook sequence를 legacy SessionStore와 v2 reducer 양쪽에 입력
3. timestamp/order처럼 의도된 차이를 normalize한 뒤 deep equality 비교
4. 20개 variant 각각 producer/consumer contract test
5. reconnect, dormant, missing, terminal restore 순서 E2E

호환 제거 조건은 “v2 UI 구현 완료”뿐 아니라 최근 2개 minor release의 v1 client 접속 비율 또는 명시된 deprecation 기간을 만족하는 것으로 바꾼다.

---

## K. 영속화·캐시·복원

### K.1 저장 원칙

SQLite WAL을 기본 저장소로 사용한다. 현재 여러 JSON 파일과 localStorage에 흩어진 상태를 단계적으로 합친다.

| 데이터 | 저장 위치 | 보존 기본값 |
|---|---|---|
| 정규화 이벤트 | SQLite `events` | 30일 또는 크기 제한 |
| 세션/실행 Projection | SQLite | 사용자가 삭제할 때까지 |
| 결과/산출물 메타 | SQLite | 사용자가 삭제할 때까지 |
| 터미널 scrollback | 메모리 ring + 압축 chunk 파일/DB | 7일, 세션별 상한 |
| 레이아웃/필터 | SQLite + 브라우저 draft | 영구 |
| 원본 transcript 경로 | 참조만 저장 | 공급자 정책에 따름 |
| 토큰/비용/Efficio | SQLite | 집계는 장기 보존 가능 |
| 비밀정보 | OS Keychain/공급자 저장소 | DB에 평문 저장 금지 |

### K.2 Projection

- `sessions_current`
- `agents_current`
- `approvals_pending`
- `results_current`
- `usage_rollups_daily`
- `connection_health`

Projection은 이벤트에서 재생성 가능해야 하며, migration 실패 시 원본 이벤트를 보존한다.

### K.3 복원 등급

| 등급 | 의미 |
|---|---|
| A | 구조화 세션 ID로 완전 resume 가능 |
| B | 프로세스가 살아 있으면 attach, 재시작 후 공급자 resume 가능 |
| C | scrollback과 결과만 복원, 대화 resume 불가 |
| D | 터미널 기록도 없는 외부 세션 |

UI는 “복원됨” 하나로 뭉개지 않고 등급과 제한을 보여준다.

### K.4 캐시

- 공급자 모델/기능 목록: TTL + explicit refresh
- MCP inventory/status: 짧은 TTL, 인증 오류는 즉시 무효화
- 파일/diff 결과: content hash 기반
- Efficio 분석: `(provider, session, transcriptHash, scorerVersion)` 키
- UI snapshot: cursor와 schema version 포함
- 캐시 hit/miss 자체도 Efficio의 자원 효율 입력으로 기록

---

## L. MCP와 외부 연결 전략

### L.1 원칙

MCP는 Host가 여러 Client를 관리하고 capability negotiation으로 Server 기능을 확인하는 구조다. Alive가 모든 런타임 대신 MCP Host가 되면 인증, sampling, elicitation, tool approval, 프로토콜 버전 호환까지 떠안게 된다. 이는 “가벼운 통합 UI” 목표와 충돌한다.

따라서 MVP는 다음 정책을 쓴다.

1. Claude/Codex/Hermes가 가진 네이티브 MCP 설정과 인증을 우선한다.
2. Alive는 MCP 서버의 이름, transport, 연결 상태, 제공 capability, 인증 필요 여부를 표시한다.
3. 프로젝트 템플릿은 공급자별 설정 변환을 제공하되 실제 비밀은 복사하지 않는다.
4. 사용자가 명시적으로 선택한 경우에만 Alive 공용 MCP proxy를 후속 기능으로 제공한다.
5. 신뢰되지 않은 MCP 응답은 에이전트 입력 표면이므로 권한과 sandbox 경계를 유지한다.

### L.2 Connection Center

- Runtime 설치 감지와 버전
- 로그인/인증 상태(가능한 경우)
- MCP 서버 ready/failed/reauth-required
- SSH/컨테이너 대상 health
- 공급자별 capability matrix
- `doctor` 실행과 수정 안내

### L.3 자동 연결의 의미

“알아서 그때 연결”은 임의 설치나 자동 권한 부여가 아니다.

- 작업이 요구한 capability와 현재 연결을 비교한다.
- 이미 승인·설정된 연결은 자동 재사용한다.
- 설치/로그인/새 권한이 필요하면 이유와 범위를 보여주고 사용자의 승인을 받는다.
- 일시 오류는 backoff로 재연결하고, 인증 오류는 무한 재시도하지 않는다.

---

## M. Efficio 확장 계획

### M.1 목표

“토큰을 적게 썼다”가 아니라 “필요한 결과에 비해 불필요한 반복과 자원 소모가 얼마나 적었는가”를 본다.

### M.2 공통 측정 사실

- 입력/출력/캐시 생성/캐시 읽기 토큰
- API 호출 수와 모델
- wall time, active time, waiting-user time
- tool call 수, 실패/재시도, 같은 파일 재편집
- 테스트 실행/실패/재실행
- 생성 diff, 커밋, 결과 artifact
- 사용자 개입, 중단, 후속 수정
- 공급자가 제공한 실제 비용 또는 명시된 추정 비용

### M.3 점수 체계

단일 종합 점수보다 다음 묶음을 기본으로 노출한다.

1. **Outcome evidence**: 테스트 통과, 사용자의 수락, 산출물 존재
2. **Waste residual**: 작업 규모 대비 반복·재작업 잔차
3. **Token efficiency**: 결과 증거 대비 토큰, cache-read 비율
4. **Interaction burden**: 불필요한 사용자 개입과 승인 대기
5. **Reliability**: 오류, 재시도, 중단, 복원 성공률

종합 지표가 필요하면 `Outcome-adjusted Efficiency`를 실험 지표로 제공하되 다음을 함께 표시한다.

- scorer version
- 비교 집단(provider/model/task type)
- 표본 수
- confidence
- 누락된 입력

### M.4 공급자 비교 주의

- Claude와 Codex의 cache token 정의가 다르면 원값을 직접 비교하지 않는다.
- 구조화 이벤트와 PTY 추론 데이터는 같은 신뢰도로 취급하지 않는다.
- 모델·작업 유형·난이도 보정 전 순위표를 만들지 않는다.
- provider 간 Efficio 비교를 공개하기 전 M1 난이도/게이트를 구현하고 비교 타당도를 별도로 검증한다.
- “좋은 결과” 라벨은 자동 신호만으로 확정하지 않고 사용자 수락·테스트·리뷰를 분리한다.

이 순서는 `docs/efficio-status.md`와 일치한다. 현재 상태는 M0 제품 통합 완료, M1(게이트 명세·난이도 보정·SLO) 미착수이며, H1 정식 검증은 ≥2 평정자와 약 n=70 라벨이 필요한 외부 차단 항목이다. 다만 “먼저 해결”이 멀티 에이전트 플랫폼의 P0/P1 전체를 막는다는 뜻은 아니다.

두 dependency를 분리한다.

| 작업 | 플랫폼 critical path | 시점 |
|---|---|---|
| 기존 Claude Efficio 화면/DB 호환 유지 | 예 | P0~P1 회귀 gate |
| operational `workspaceId/sessionId/provider/model` 연결 스키마 | 예 | P0 설계, P1 dual-write |
| Prompt/Efficio DB ownership 유지 | 예 | P0 ADR |
| M1 게이트·난이도·SLO 구현 | provider 비교에만 필수 | P0과 병렬 spec, P5 구현 완료 전 gate |
| H1 정식 다중 평정자 검증 | 아니오, 외부 데이터 차단 | 데이터 확보 시 별도 validation lane |
| provider/model/task 비교 calibration | Efficio 비교 기능에 필수 | P5, M1 이후 |

따라서 P0~P4에서는 공급자별 raw usage와 measurement confidence를 수집하되 **provider 순위·종합 비교를 노출하지 않는다**. P5는 M1 완료 여부를 entry gate로 확인한다. H1 정식 검증이 끝나지 않았으면 Efficio는 계속 experimental/provisional label을 유지하되 플랫폼과 세션 UI 출시는 막지 않는다.

### M.5 스키마 추가

`provider`, `providerVersion`, `model`, `taskType`, `workspaceId`, `runId`, `measurementSource`, `measurementConfidence`, `scorerVersion`을 Efficio session/profile에 추가한다.

---

## N. 보안·프라이버시·권한

### N.1 기본 보안선

- 서버는 기본 `127.0.0.1` bind. LAN 공개는 명시적 설정.
- HTTP Origin 검증, WebSocket origin 검증, CSRF 방어.
- LAN/원격 사용 시 bearer session + TLS reverse proxy 필수.
- 공급자 app-server/gateway는 가능한 stdio 자식 프로세스로 붙여 외부 포트를 열지 않는다.
- API key/OAuth token을 Alive SQLite, 로그, 이벤트 payload에 저장하지 않는다.
- 환경 변수 전달 allowlist와 redaction을 적용한다.
- 터미널 출력과 transcript의 PII/secret 필터는 저장 전·표시 전 두 단계로 둔다.
- 세션 종료/삭제/데이터 export를 UI에서 제공한다.

### N.2 승인

- 공급자의 native approval을 그대로 전달하고 Alive가 임의로 승인하지 않는다.
- “항상 허용”은 공급자/프로젝트/도구 범위와 만료를 명시한다.
- 자동 모드는 별도 policy profile이며 기본값이 아니다.
- 승인 이벤트에는 요청 명령, cwd, 네트워크/파일 영향, 공급자, 세션을 표시한다.
- 자동 승인 결정은 audit event로 남긴다.

### N.3 원격·다중 사용자

MVP는 단일 사용자 로컬 앱이다. 원격 접속과 팀 기능은 인증, 세션 소유권, RBAC, 비밀 격리, 감사 로그가 준비된 뒤 별도 단계로 연다. 단순히 `0.0.0.0`으로 bind하는 것은 제품 기능으로 인정하지 않는다.

---

## O. 성능·신뢰성 목표

### O.1 SLO 초안

| 항목 | 목표 |
|---|---|
| 구조화 이벤트 → UI p95 | 로컬 250ms 이하 |
| 승인 이벤트 → UI p95 | 500ms 이하 |
| 20개 세션 snapshot | 1초 이하 |
| 브라우저 재접속 후 상태 복원 | 2초 이하 |
| 서버 재시작 후 복원 가능한 세션 발견 | 5초 이하 |
| 이벤트 유실 | 정상 종료/재연결 경로에서 0, 비정상은 gap 표시 |
| 16개 Spread 타일 | 지속 조작 가능한 30fps 목표, 출력 폭주 시 샘플링 |
| idle daemon 메모리 | 기본 구성 250MB 이하 목표 |

### O.2 Backpressure

- PTY output은 타일이 보이지 않을 때 렌더 빈도를 낮춘다.
- 이벤트와 터미널 출력 큐를 분리한다.
- scrollback 제한 단위를 명확히 하고 byte 기준 chunk deque로 수정한다.
- 분석 worker는 비동기 큐로 분리하고 UI broadcast를 막지 않는다.
- adapter별 재연결은 exponential backoff + jitter + circuit breaker를 사용한다.

#### 현재 scrollback 구현의 정확한 진단

- `packages/server/src/terminalManager.ts:14`: 상수 이름은 `SCROLLBACK_MAX_BYTES = 256 * 1024`
- `terminalManager.ts:276–277`: 새 출력 문자열을 `managed.scrollback += data`로 연결
- `terminalManager.ts:278`: `managed.scrollback.length`와 byte 상수를 비교
- `terminalManager.ts:279`: `slice(-SCROLLBACK_MAX_BYTES)`로 자름

JavaScript string의 `.length`는 UTF-8 byte 수가 아니라 UTF-16 code unit 수다. 따라서 ASCII는 우연히 1:1에 가깝지만 한글·emoji에서 256 KiB 제한과 실제 메모리/전송량이 달라진다. 단순히 `Buffer.byteLength(scrollback)`를 비교한 뒤 Buffer 중간을 자르는 방식도 UTF-8 문자, surrogate pair, ANSI sequence를 끊을 수 있어 충분하지 않다.

권장 구현:

```ts
interface ScrollbackBuffer {
  chunks: Array<{ text: string; utf8Bytes: number }>;
  totalUtf8Bytes: number;
  maxUtf8Bytes: number;
}
```

- `node-pty`가 전달한 data chunk 단위로 `Buffer.byteLength(data, 'utf8')`를 누적한다.
- 상한을 넘으면 가장 오래된 **완전한 chunk**부터 제거한다.
- 단일 chunk가 상한보다 크면 UTF-8 boundary를 보존하는 helper로 끝부분만 남긴다.
- replay 시작이 ANSI 상태 중간일 수 있음을 인정하고, attach 후 기존 `forceRedraw`를 계속 호출한다.
- 테스트는 ASCII, 한글, emoji/surrogate pair, ANSI, 단일 oversized chunk를 포함한다.

만약 제품 요구가 정확한 byte 제한이 아니라 단순 code-unit 상한이라면 상수를 `SCROLLBACK_MAX_CODE_UNITS`로 바꾸는 것도 정직한 대안이다. 다만 WebSocket 전송량과 보존 크기 SLO를 관리하려면 UTF-8 byte 기준이 더 적합하다.

### O.3 장애 표현

- provider disconnected
- event stream gap
- process alive but structured channel lost
- auth expired
- resume unsupported/failed
- analysis stale

각 상태는 UI와 로그에서 원인·영향·복구 동작을 구분해 보여준다.

---

## P. 단계별 개발 로드맵

### P0 — 계약과 마이그레이션 기반 (3~4주)

- P0a Discovery/contract freeze(약 1주): 현재 11개 package·3개 DB·4개 session source inventory, ADR-001~003/006~009
- P0b Foundation(약 2~3주): schema, storage, dual projection, migration fixture, conformance harness
- 공통 ID, event envelope, capability, domain type 확정
- Location → Workspace → Session → Conversation 관계와 title policy 확정
- SQLite event/projection migration 추가
- 기존 open tabs/managed sessions/project names를 읽는 migration fixture
- v1 Claude event → v2 canonical 변환기
- adapter conformance test harness
- Connection/Runtime doctor CLI 골격
- i18n namespace와 EN/KO parity/raw-text checker
- Prompt/Efficio DB ownership 및 session ID link contract
- Efficio M1 gate spec은 병렬 readiness lane으로 시작하되 P0 exit를 막지 않음
- 제품명/패키지명 결정은 이 단계 말에 ADR로 확정

**Exit gate:** 기존 Claude 기능과 테스트가 유지되고, 같은 이벤트로 legacy/v2 Projection 결과가 일치하며, 한 세션이 Location/Workspace 아래 정확히 한 번 나타난다.

### P1 — Claude를 첫 Adapter로 추출 (2~3주)

- Hook ingress, transcript, CLI spawn/resume를 `ClaudeAdapter`로 이동
- 17/30 Hook coverage manifest를 doctor에 노출하고 `StopFailure`, `PermissionDenied`, `PostCompact` 지원 여부 확정
- 신규/unknown Hook raw event의 fail-open 격리와 schema-version test
- TerminalManager를 runtime-neutral로 변경
- `TerminalMode`, managed session schema 일반화 및 migration
- UI에 provider/capability 필드 추가
- Local workspace Git probe, session first-prompt title, Claude conversation reader
- 서버 소유 Workspace/Session Catalog와 `/work/sessions/:id` route
- 기존 npm/환경 변수 호환 유지

**Exit gate:** Claude 외부 세션·UI 생성 세션·Agents variant·재시작 resume·Efficio가 회귀 없이 동작하고, 세션 클릭 시 재개하지 않아도 과거 대화를 먼저 읽을 수 있다.

### P2 — Codex 구조화 통합 (2~3주)

- app-server stdio supervisor와 initialize handshake
- 버전별 generated schema fixture
- thread/turn/item/token/approval mapping
- start/input/interrupt/resume/approval
- Codex terminal 타일과 structured 상태 결합

**Exit gate:** 한 프로젝트에서 Claude와 Codex를 동시에 시작해 상태, 승인, 토큰, 완료 결과를 구분해서 볼 수 있다.

### P3 — Hermes 통합 (2~3주)

- TUI Gateway와 ACP 기술 Spike(3일 timebox)
- 선택 프로토콜의 session/message/tool/approval mapping
- branch/steer capability 노출
- remote backend의 위치·연결 상태 표시

**Exit gate:** Hermes가 Claude/Codex와 같은 Workbench와 Result Inbox에 나타나며 미지원 기능은 명확히 비활성화된다.

### P3.5 — SSH 구조화 bridge (1~2주, P3와 병렬 가능)

- SSH preset을 `Location`으로 migration
- 선택 cwd에 대한 remote Git read-only probe
- 원격 structured adapter를 SSH stdio로 실행하는 optional companion
- companion이 없을 때 scrollback-only capability로 명확히 degrade
- 연결 단절, 재인증, 원격 프로세스 생존 여부 분리 표시

**Exit gate:** SSH 위치의 repo/session이 Local과 같은 계층에 표시되고, bridge 유무에 따라 대화 이력 capability가 정확히 표현된다.

### P4 — 통합 Workbench·Results·Connections (2~3주)

- Work/Data 상위 정보 구조와 Location → Workspace → Session tree
- 세션 선택 시 Conversation 기본 화면, Terminal/Inspector 전환
- Animation/List/Spread의 공통 selection·scope·filter
- provider/project/state filter와 레이아웃 preset
- Result Inbox와 artifact builder
- Quiet Mode, notification routing, digest
- Connection Center와 doctor UI
- EN/KO 번역 및 접근성

**Exit gate:** 사용자가 Local/SSH → Repo → Session을 빠르게 탐색하고, 세션의 대화와 터미널을 전환하며, 공급자별 터미널을 자유 배치하고, 화면을 닫았다 돌아와 결과를 검토할 수 있다.

### P5 — Efficio 교정과 비교 (2~3주)

- **Entry gate:** M1 게이트 명세·난이도 보정·SLO 구현 완료 또는 Efficio 비교 scope 축소 결정
- provider/model/task 차원과 confidence
- 공통 usage collector
- 비교 가능/불가능 조건 UI
- M1 게이트·난이도 보정 우선 구현
- 캐시/재시도/개입 지표

**Exit gate:** 서로 다른 공급자의 데이터가 출처와 신뢰도 없이 섞이지 않으며, 같은 조건에서만 비교가 허용된다.

### P6 — Handoff·자동 연결 보조 (2주)

- Handoff Pack: 목표, 요약, 변경사항, 남은 일, 파일 참조
- capability 요구 기반 runtime/MCP 연결 안내
- 승인된 연결 자동 재사용과 health recovery
- 작업 템플릿과 provider 선택 추천(설명 가능 규칙 기반)

**Exit gate:** 대화 원문을 강제로 공유하지 않고도 사용자가 다른 공급자에 작업을 안전하게 이어 줄 수 있다.

### 일정 요약

- **구조형 UX MVP(Claude + Local/SSH catalog + Conversation): 8~11주**
- **멀티 에이전트 MVP(Claude + Codex + Workbench/Results): 12~16주**
- **3-provider beta + SSH bridge + Efficio: 18~24주**
- 권장 인원: 풀타임 2명(backend/runtime 1, frontend/product 1) + Efficio/QA 파트타임 1명
- **1인 개발:** 기능 구현만 26~32주, 통합 디버깅·polish·i18n·migration 문서·release hardening을 포함한 현실적 범위는 **32~40주**

일정에는 provider CLI/API 변경이나 외부 validation 데이터 대기가 포함되지 않는다. 각 phase 뒤 15~20% stabilization buffer를 두며, 앞 단계 exit gate가 실패하면 다음 provider adapter 착수를 미룬다.

---

## Q. Epic과 우선순위 백로그

### Must

- E1 Canonical event/domain contract
- E2 SQLite event log/projection
- E3 Claude adapter extraction
- E4 Codex app-server adapter
- E5 provider-neutral runtime/session store
- E6 Workbench provider tiles and filters
- E7 native approval bridge
- E8 Result Inbox
- E9 persistence/reconnect/gap handling
- E10 security baseline and doctor

### Should

- E11 Hermes gateway adapter
- E12 Connection Center/MCP inventory
- E13 Quiet Mode/digest
- E14 layout presets and server sync
- E15 Efficio provider calibration
- E16 Handoff Pack

### Could

- 작업 템플릿별 provider 추천
- 동일 목표의 나란히 실행과 결과 비교
- 원격 모바일 read-only 상태 화면
- artifact preview와 리뷰 코멘트
- plugin SDK/third-party adapter manifest

### Won't in initial release

- 중앙 LLM router와 자동 모델 중계
- 임의의 다중 에이전트 계획 그래프 생성기
- 공급자 간 비밀·기억 자동 복제
- 팀 SaaS와 과금
- 승인 없는 자동 MCP 설치/로그인

---

## R. 테스트 전략

### R.1 Adapter Conformance Suite

모든 adapter가 같은 fixture 계약을 통과해야 한다.

- detect/health
- start → streaming → complete
- tool start/complete/failure
- approval request/decision
- interrupt
- disconnect/reconnect
- duplicate/out-of-order event
- token finalization
- unsupported capability

실제 CLI가 없어도 recorded protocol fixture로 결정론적 테스트를 실행한다. 실제 설치본 smoke test는 별도 opt-in으로 둔다.

### R.2 계층별 테스트

- Core: schema, ID, state mapping, dedupe, reducer property tests
- Storage: migration, WAL recovery, projection rebuild, retention
- Runtime: PTY lifecycle, attach, resize, exit, crash recovery
- Server: HTTP/WS auth, cursor resume, backpressure, v1 compatibility
- UI: provider capability rendering, approval, filters, restore, EN/KO
- E2E: Claude/Codex/Hermes fixture 동시 실행, 20-session load
- Security: secret redaction, origin, path scope, malformed provider payload

### R.3 릴리스 게이트

- `pnpm build`, 전체 unit/integration 통과
- UI TypeScript noEmit 통과
- migration downgrade가 아니라 백업/복구 절차 검증
- 기존 Claude-only 사용자 데이터 migration fixture 통과
- 브라우저에서 Workbench/승인/재접속/Result 핵심 플로우 확인
- i18n 누락 키 검사

---

## S. 관측성과 운영

- 구조화 JSON 로그: provider, adapter, workspaceId, sessionId, eventId; 프롬프트/비밀 제외
- 내부 metrics: adapter connected, event lag, queue depth, dropped output bytes, reconnect count, projection lag
- health endpoint: server/storage/adapter별 상태 분리
- support bundle: 설정 요약, 버전, redacted logs, migration 상태; 사용자 확인 후 export
- 기본 제품 telemetry는 없음. 향후 opt-in 익명 telemetry를 도입할 경우 별도 동의와 스키마 공개가 필요하다.

---

## T. 제품 KPI

### 핵심 성공 지표

- 세션 재접속/복원 성공률
- 승인 요청 누락률과 승인까지 걸린 시간
- 완료 Result가 자동으로 만들어지는 비율
- 사용자가 터미널을 상시 감시하지 않은 시간
- 동일 작업 유형에서 재작업·실패·불필요 호출 감소
- 주간 활성 사용자의 2개 이상 provider 사용 비율

### 가드레일 지표

- provider-native 기능 회귀
- 이벤트 gap 발생률
- 잘못된 공통 상태 매핑률
- 자동 연결/재시도로 인한 반복 실패
- Efficio confidence 낮은 비교 노출률
- 저장 데이터와 scrollback 크기

“총 토큰 증가”를 성공으로 보지 않는다. 병렬 사용으로 토큰이 늘어도 완료 시간과 결과 품질이 좋아질 수 있으므로 outcome과 함께 본다.

---

## U. 주요 리스크와 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| 공급자 프로토콜 변경 | adapter 중단 | 버전 감지, generated schema, fixture, capability downgrade |
| 상태 의미 불일치 | 잘못된 UI/비교 | raw state 보존, confidence, provider별 mapper |
| PTY와 structured stream 불일치 | 중복/유령 세션 | session correlation table, source priority, conflict 표시 |
| 이벤트 폭주 | UI 지연/메모리 | 채널 분리, bounded queue, coalescing, cursor resync |
| 서버 재시작 | 실행 손실 | 공급자 resume, managed registry, 복원 등급 |
| MCP/외부 입력 injection | 코드·비밀 위험 | 네이티브 승인, sandbox, 신뢰 표시, allowlist |
| 제품 범위 팽창 | 핵심 UX 지연 | orchestration non-goals와 phase gate 유지 |
| Efficio 허위 정밀도 | 잘못된 판단 | confidence/표본/버전, 비교 제한, 검증 선행 |
| 이름 변경 생태계 파손 | 설치/업데이트 실패 | alias CLI, env fallback, deprecation 2단계 |

---

## V. 브랜딩·호환성 마이그레이션

`claude-alive`라는 이름은 이미 사용자와 npm 설치 경로에 가치가 있다. 기능 추가와 이름 변경을 동시에 하면 문제 원인을 분리하기 어렵다.

권장 순서:

1. 내부 UI에서 “Alive Workspace”를 가칭으로 사용하되 CLI는 `claude-alive` 유지
2. `agent-alive`, `alive-workspace` 등 이름·npm·도메인 충돌 조사
3. 최종 결정 후 새 CLI를 추가하고 기존 CLI는 동일 binary alias로 2개 minor release 유지
4. `CLAUDE_ALIVE_*`를 읽되 새 환경 변수가 있으면 우선하도록 fallback
5. `@claude-alive/*` 내부 scope 변경은 제품 안정화 후 별도 major에서 수행

초기 기술 작업은 브랜딩 변경에 의존하지 않아야 한다.

---

## W. 핵심 ADR(Architecture Decision Record) 목록

모든 ADR을 개발 착수 전에 확정할 수는 없다. 계약과 데이터 소유권 ADR은 P0에서 먼저 고정하지만 provider transport ADR은 해당 Spike의 증거가 나온 뒤 확정한다.

| ADR | 주제 | 현재 상태 | 확정 gate |
|---|---|---|---|
| ADR-001 | thin orchestration/control plane | Proposed → P0 Accepted | P0 contract review |
| ADR-002 | canonical event + raw event 보존 | Proposed | P0 fixture review |
| ADR-003 | operational SQLite + rebuildable projection, Prompt/Efficio DB 분리 | Proposed | P0 storage prototype |
| ADR-004 | Codex app-server stdio transport | **Conditionally Accepted** | 0.144.5 schema/handshake 확인 완료; P2 lifecycle smoke 후 Accepted |
| ADR-005 | Hermes TUI Gateway vs ACP | **Pending** | P3 3-day Spike 결과 |
| ADR-006 | native MCP 우선, 중앙 proxy opt-in | Proposed | P0 security review |
| ADR-007 | provider capability 기반 UI | Proposed | P0 adapter contract |
| ADR-008 | Efficio 비교 조건/confidence | Proposed | M1 spec + P5 calibration plan |
| ADR-009 | 로컬 단일 사용자 보안 경계 | Proposed | P0 threat model |
| ADR-010 | 제품명과 호환 migration | Pending | P0 말 branding/package 조사 |
| ADR-011 | prompt packages 유지와 canonical ingest 경계 | Proposed | P0 package/data ownership review |
| ADR-012 | v1 20-variant compatibility projection/deprecation | Proposed | P0 golden fixture + P1 dual-run |

`Proposed`는 구현 가설, `Conditionally Accepted`는 제한된 Spike 증거가 있으나 exit gate가 남은 상태, `Accepted`는 구현과 테스트로 검증된 상태를 뜻한다.

---

## X. 첫 30일 실행안

### 1주차

- 11개 package, 3개 DB, 4개 session source inventory
- 공통 glossary와 event kind 워크숍
- Location/Workspace/Session/Terminal 경계와 UI tree fixture 확정
- 세션 제목 생성 규칙과 한글/emoji 단위 테스트 fixture 확정
- Claude 17/30 Hook coverage manifest와 기존 event fixture
- `ProviderCapabilities`, `CanonicalEvent`, ID 초안

### 2주차

- operational SQLite schema, DB ownership ADR, migration/back-up 전략
- v2 event store/projection prototype
- current unversioned WebSocket 20-variant golden fixture
- Local Git workspace probe와 Session Catalog prototype
- i18n namespace/parity checker
- adapter conformance harness

### 3주차

- 기존 Claude `SessionStore`와 v2 reducer dual-run 비교
- open tabs, managed sessions, project names migration fixture
- snapshot 5필드와 terminal reconnect/restore 호환 검증
- Prompt/Efficio session ID link와 회귀 fixture
- doctor CLI의 설치/version/Hook coverage 출력

### 4주차

- schema/projection rebuild, corrupt data, rollback/backup recovery test
- P0 ADR-001~003/006~009/011~012 review
- package/build/release script가 신규 flat package를 포함하는지 검증
- legacy/current protocol dual projection 성능 측정
- P0 exit gate와 P1 Claude Adapter 착수 승인

첫 30일의 목표는 화려한 새 화면이나 Codex 타일이 아니다. “Claude 전용 현행 동작을 깨지 않고 Local → Repo → Session → Conversation 계약, operational storage, legacy compatibility fixture가 검증되는 것”이다. Claude Adapter 추출은 5주차 이후 P1, Codex full lifecycle과 첫 타일은 P2에서 진행한다. 2026-07-16에 수행한 Codex schema/handshake Spike는 P2 위험 제거를 위한 선행 조사이지 P0 구현 범위가 아니다.

---

## Y. 완료 정의

통합 beta는 다음 조건을 모두 만족해야 한다.

- Claude, Codex, Hermes 설치 여부와 capability가 Connections에 표시된다.
- Local과 SSH가 provider가 아닌 Location으로 표시되고 그 아래 Workspace/Session이 계층화된다.
- Git repo name과 folder fallback이 일관되며 remote credential이 저장되지 않는다.
- 첫 실제 질문에서 기본 10자 제목이 한 번 생성되고 사용자가 변경할 수 있다.
- 세션을 클릭하면 실행을 강제로 재개하지 않고 Conversation이 먼저 열린다.
- history를 지원하지 않는 연결은 가짜 대화를 만들지 않고 scrollback-only 상태를 표시한다.
- 세 공급자 세션을 동일 프로젝트에서 생성·관찰·입력·중단/재개할 수 있다(지원 capability 범위 내).
- 승인 요청이 올바른 세션에 귀속되고 공급자 native 결정으로 반환된다.
- Spread 레이아웃이 프로젝트 preset으로 저장되고 재시작 후 복원된다.
- 브라우저가 닫혀도 서버 소유 실행이 계속되며 Result Inbox에서 완료를 확인한다.
- 구조화 이벤트 유실이나 adapter 단절이 UI에 표시된다.
- 토큰/비용/캐시의 출처와 추정 여부가 표시된다.
- Efficio는 provider/model/task 조건과 confidence 없이 공급자를 순위화하지 않는다.
- MCP는 승인된 네이티브 설정을 재사용하며 Alive가 비밀을 평문 복제하지 않는다.
- 기존 Claude-only 설치·Hook·resume·Pixel Office·Efficio 사용 흐름이 깨지지 않는다.

### Y.1 구조형 UX 선행 완료 기준

멀티 provider beta보다 먼저 다음만으로도 독립적인 제품 개선 release를 낼 수 있다.

1. `claude-alive start`와 현재 Local/SSH terminal 생성 흐름이 그대로 작동한다.
2. 왼쪽 tree가 Local/SSH → Workspace → Session 순서로 일관되게 표시된다.
3. 같은 repo의 여러 세션이 서로 다른 자동 제목으로 구분된다.
4. 세션 클릭 시 대화, 터미널, 상태 Inspector를 오갈 수 있다.
5. Animation/List/Spread가 같은 session selection과 filter를 공유한다.
6. Prompt/Efficio에서 Session으로 drill-down할 수 있다.
7. 브라우저 새로고침 후 tree, 선택 세션, 열린 터미널, 레이아웃이 복원된다.

이 7개 조건은 Claude 단일 provider만으로도 구현·출시할 수 있다. 먼저 이 기반을 완성하면 Codex/Hermes는 새 UI를 다시 만들지 않고 adapter와 capability만 추가해 들어온다.

---

## Z. 최종 권고

가장 먼저 해야 할 기능은 “멀티 에이전트 자동 지휘자”가 아니라 **provider-neutral contract와 Codex 구조화 adapter**다. 이 기반 없이 화면부터 공급자 선택 버튼으로 늘리면, 실제 상태는 계속 Claude 타입에 억지로 들어가고 복원·승인·효율 분석이 빠르게 깨진다.

권장 제품 순서는 다음과 같다.

```text
공통 계약 → Claude 추출 → Codex 구조화 통합 → Workbench/Results 완성
          → Hermes 통합 → Efficio 교정 → Handoff/자동 연결 보조
```

이 순서라면 현재 강점인 Pixel Office, Spread terminal, 세션 복원, Efficio를 버리지 않고 확장할 수 있다. 동시에 Alive가 또 하나의 무거운 에이전트가 되는 것을 피하고, 사용자가 여러 에이전트를 편안하게 맡겨 두고 필요한 순간과 결과만 선명하게 확인하는 제품에 집중할 수 있다.

---

## 참고한 공식·1차 자료

- [OpenAI Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) — JSON-RPC, thread/turn/item, approvals, token usage, MCP 상태
- [OpenAI Codex repository](https://github.com/openai/codex) — Codex CLI 및 공개 구현
- [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage) — CLI, resume, stream-json, MCP 관련 옵션
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) — 공식 Hook 30종과 event별 입력·제어 계약
- [Claude Code MCP overview](https://docs.anthropic.com/en/docs/mcp) — Claude 제품의 MCP 지원 범위
- [MCP Architecture specification](https://modelcontextprotocol.io/specification/2025-06-18/architecture) — Host/Client/Server와 capability negotiation
- [Hermes Agent repository](https://github.com/NousResearch/hermes-agent) — Hermes 런타임, 세션·도구·MCP·서브에이전트
- [Hermes programmatic integration](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md) — ACP, TUI Gateway JSON-RPC, HTTP API

## 저장소 내부 근거

- `packages/core/src/events/types.ts`
- `packages/core/src/protocol/wsProtocol.ts`
- `packages/server/src/index.ts`
- `packages/server/src/terminalManager.ts`
- `packages/server/src/managedSessionStore.ts`
- `packages/ui/src/App.tsx`
- `packages/ui/src/views/chat/ChatOverlay.tsx`
- `packages/ui/src/views/chat/useSpreadView.ts`
- `docs/efficio-status.md`
- `docs/plans/2026-07-15-jarvis-and-spread-views-design.md`
- `docs/plans/2026-07-16-spread-view-interactive-tiling-design.md`

## 부록 A. 2026-07-16 외부 피드백 판정

| 피드백 | 판정 | 확인 결과/조치 |
|---|---|---|
| prompt 패키지 위치 누락 | **핵심 지적 타당, 수치는 오류** | 실제는 총 11개 중 prompt 5개. G.2에 flat migration, 각 책임, DB 소유권 추가 |
| scrollback byte/string | **타당** | `terminalManager.ts:14, 276–280` 확인. O.2에 chunk/UTF-8 경계 구현안 추가 |
| v1 호환 상세 부족 | **타당, variant 수는 오류** | 실제 outbound union은 20개. J.3에 전 variant와 snapshot/golden test 매핑 추가 |
| Codex stdio 미검증 | **당시 타당, 현재 부분 해소** | 0.144.5 help/schema/TS/handshake 검증. full lifecycle은 미검증이므로 ADR-004 조건부 유지 |
| Hermes 검증 부채 | **타당** | ADR-005를 Pending으로 명시, P0 exit와 분리 |
| `buildClaudeCommand` 미존재 가능성 | **부정확** | `claudeTerminal.ts:89`에 export, 전용 test 존재. D.2에 근거 추가 |
| i18n 작업량 누락 | **타당** | 현재 375 key/locale 확인. F.12에 140~190 key/locale budget과 CI 규칙 추가 |
| Efficio M1 시점 모순 | **부분 타당** | M1 미착수·정식 검증 차단은 status와 일치. 플랫폼 critical path와 비교 기능 gate를 분리 |
| P0 2주 과소추정 | **타당** | 3~4주, discovery/foundation 분할, stabilization buffer 추가 |
| 1인 18~24주 낙관 | **타당** | 구현 26~32주, release hardening 포함 32~40주로 수정 |

### 추가로 확인된 누락

1. **workspace glob/build 경계:** 현재 `packages/*`만 인식하므로 중첩 adapter 구조는 pnpm/Turbo/release script 검증 없이 사용할 수 없다.
2. **세 개 DB의 소유권:** operational, Prompt, Efficio DB를 즉시 합치면 Node/Python writer와 migration 책임이 충돌한다.
3. **Prompt 분석 coverage:** `prompt-agent`가 Claude Hook payload에 직접 결합되어 있어 adapter만 추가한다고 Codex/Hermes prompt 분석이 자동 지원되지 않는다.
4. **Codex schema drift:** app-server 생성물은 설치 버전별이므로 version matrix, schema hash, unsupported fallback이 필요하다.
5. **v1 cwd identity 한계:** `project:names`의 cwd-key map은 Local/SSH 동일 경로를 구분하지 못한다. v1은 local Claude 범위로 제한해야 한다.
6. **SSH session persistence:** 현재 browser open-tab persistence는 local Claude만 대상으로 하므로 SSH의 repo/session catalog와 PTY 생존/재연결을 별도 설계해야 한다.
7. **제목의 privacy:** first prompt 제목은 prompt 원문을 또 저장하는 경로가 될 수 있어 redaction, preview/full-text 분리, 보존 정책이 필요하다.

이 부록의 판정은 문서 표현이 아니라 2026-07-16 현재 repository와 로컬 `codex-cli 0.144.5` 실행 결과를 기준으로 한다.

## 부록 B. 2차 교차검증 의견 판정

| 의견 | 판정 | 확인 결과/조치 |
|---|---|---|
| Claude Hook은 17종보다 많음 | **타당** | 공식 reference 30종, 현재 등록 17종. H.3에 17/30 coverage와 누락 13종 우선순위 추가 |
| Hermes `session.resume` 없음 | **부분 타당** | 공식 method catalog에는 없지만 같은 공식 문서 Pi mapping에는 존재해 내부 불일치. 확정 명칭 제거, P3 wire Spike로 이관 |
| Codex `--stdio` 플래그 없음 | **현재 기준 부정확/구버전 시점 차이 가능** | 공식 최신 README와 로컬 0.144.5 help 모두 alias 명시. 실행 예시는 version 호환을 위해 stdio 기본인 `codex app-server`로 단순화 |
| `/api/event` 근거 파일 | **타당한 정밀화** | route/normalize는 `httpRouter.ts:189`, injected `onEvent` processing은 `server/index.ts`. D.2에 책임 분리 추가 |
| `WSServerMessage v1` 코드 marker 없음 | **타당** | 현재 unversioned protocol임을 J.3에 명시하고 v1은 문서상 migration alias로 제한 |
| 저장소 전체 v0.5.9 | **타당한 정밀화** | v0.5.9는 root 제품 버전, workspace는 Alive 0.1.0/Prompt 0.6.0임을 header에 명시 |
| FSM이 class가 아님 | **타당한 정밀화** | `TRANSITIONS` + `transition()` 함수형 구현임을 D.2에 명시 |
| Jarvis mode가 union에 존재 | **타당한 신규 발견** | Header/renderer가 없는 dormant mode로 기록, P0 제거/연결 결정 추가 |
| 기존 일정에 내부 모순 없음 | **검증 대상 버전이 오래됨** | 보고서의 P0=2주·MVP 9~12주 계산은 수정 전 문서. 현재는 P0 3~4주, MVP 12~16주, beta 18~24주 |

### 공식 자료 기준 주의사항

- Claude Hook 전체 수는 Claude Code version에 따라 변할 수 있으므로 숫자 30을 영구 상수로 두지 않고 coverage manifest와 doctor 결과로 관리한다.
- Hermes 문서처럼 method catalog와 mapping 표가 충돌할 수 있으므로 README의 한 줄을 adapter compile-time contract로 복사하지 않는다.
- Codex는 지원 설치 version에서 생성한 schema가 그 version의 계약이다. 공식 README와 로컬 `--help`를 함께 확인하고 schema hash를 기록한다.
- 외부 검증 보고서에는 검증한 commit/document version을 반드시 남긴다. 일정처럼 빠르게 수정되는 항목은 line number만으로 교차검증하지 않는다.

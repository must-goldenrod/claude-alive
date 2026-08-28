# 레포–런 계층 UI 재편 / Repo–Run Hierarchy UI Redesign

- 날짜: 2026-08-28
- 상태: 승인됨 (brainstorming)
- 관련 스펙: [ticket-centric-ia](2026-07-22-ticket-centric-ia-design.md), [unified-board](2026-07-24-unified-board-design.md), [session-ticket-management-split](2026-07-22-session-ticket-management-split-design.md)

## 1. 배경 / Background

프로젝트는 애니메이션 대시보드에서 출발해 스프레드 뷰, 티켓 기반 실행, 통합 보드로 확장됐다.
그 결과 **1차 엔티티가 세 갈래로 분열**했다.

| 축 | 뷰 | 엔티티 | 완결 추적 |
|---|---|---|---|
| 티켓 | `tickets`, `board/WorkTab` | `Ticket` | 있음 (자동 검증 + 평가) |
| 세션 | `list`, `archive`, `animation` | `AgentInfo` / `CompletedSession` | 부분 |
| 터미널 | `spread`, `ChatOverlay` | 탭 (`tabId` + cwd) | 없음 |

셋을 잇는 키는 `Ticket.claudeSessionId` 하나이며 optional이다
(`packages/core/src/tickets/types.ts`). 사람이 직접 연 터미널·스프레드 세션은
티켓이 없어 완결 추적 파이프라인 바깥에 있다.

또한 **레포지토리가 1급 개념이 아니다.** 프로젝트명은 cwd 문자열의 basename으로
매번 파생된다 (`views/unified/ProjectSidebar.tsx:57`, `views/chat/ChatOverlay.tsx:859`).
`projectNameStore`는 cwd→별칭 매핑일 뿐이다. 따라서 브랜치·워크트리·원격(ssh)의
구분이 없고, "레포별로 여러 세션이 병렬로 시작된다"는 실제 사용 형태가 데이터
모델에 표현되지 않는다.

시각적으로는 CSS 변수 토큰(색상)만 있고 **컴포넌트 프리미티브가 없다.**
Panel/Card/Badge/Button/EmptyState를 뷰마다 인라인 `style={{}}`로 재구현하고 있어
(예: `views/tickets/TicketsView.tsx` 전체), 뷰를 옮길 때마다 밀도와 톤이 달라진다.

## 2. 목표 / Goals

1. 레포 > 워크트리/브랜치 > 런의 **단일 계층**을 도입한다.
2. 티켓 실행·터미널 세션·에이전트 세션을 **런(run)** 이라는 한 종류로 통합해
   착수부터 마무리까지 하나의 축으로 추적한다.
3. 모든 뷰가 공유하는 **공통 사이드바**를 두어 뷰 간 문맥을 유지한다.
4. **프리미티브 레이어**를 신설해 시각적 일관성을 누적시킨다.

## 3. 확정된 결정 / Decisions

1. **1차 엔티티 = 레포 > 워크트리/브랜치 > 런** (Orca형 계층).
2. **완결 판정 = 사람이 닫기 + 한 줄 결과.** 자동 추론이나 터미널 세션에 대한
   검증 에이전트 적용은 하지 않는다.
3. **상위 nav는 현행 유지.** 헤더 6개 탭(티켓/애니메이션/리스트/스프레드/보드/관제탑)을
   그대로 두고, 공통 사이드바만 셸 레벨로 승격한다. `ViewMode` 재편은 이번 범위 밖.
4. **스타일은 프리미티브 레이어 신설 + 점진 이관.** Tailwind 전면 이관은 하지 않는다.
5. **서버에 Run 레지스트리를 신설한다(A안).** read-only 파생 인덱스(B안)나
   클라이언트 파생(C안)은 사람이 쓴 outcome을 저장할 자리가 없고 워크트리를
   해석할 수 없어 채택하지 않는다.

## 4. 데이터 모델 / Data Model

```
Repository  { repoId, root, name(별칭), remoteUrl? }
  └ Worktree { worktreeId, repoId, path, branch, isPrimary }
      └ Run   { runId, worktreeId, kind, sourceId, title,
                state: running | waiting | closed | abandoned,
                outcome?: string,
                startedAt, closedAt? }
```

- `kind: 'ticket' | 'terminal' | 'agent'`.
- **Run은 소유하지 않고 참조한다.** 티켓 본문·세션 트랜스크립트·터미널 버퍼는
  기존 저장소(`ticketStore`, `SessionStore`, `terminalManager`)에 그대로 둔다.
  Run이 자체 저장하는 것은 `outcome`, `closedAt`, `state` 뿐이다.
- `repoId` = git toplevel 경로의 해시. 원격(ssh) 런은 `location`을 포함해 별도 레포로 분리.
- 레포/브랜치 해석: cwd에 대해 `git rev-parse --show-toplevel`,
  `git rev-parse --abbrev-ref HEAD`, `git worktree list`를 1회 실행 후 캐시.
  git 저장소가 아니면 경로 자체를 repoId로 하는 "비-git 레포"로 처리한다.

### 4.1 상태 사상 / State mapping

| kind | running | waiting | closed | abandoned |
|---|---|---|---|---|
| ticket | `queued`/`running`/`verifying` | `decision` | 사람이 닫음 | 사람이 포기 / `failed` |
| terminal | 탭 생존 | — | 사람이 닫음 | 사람이 포기 |
| agent | 세션 활성 | `waiting` | 사람이 닫음 | 사람이 포기 |

**티켓의 자동 검증은 그대로 유지한다.** 검증 통과 = `Ticket.state === 'done'`이며,
그와 별개로 사람이 닫아야 `Run.state === 'closed'`가 된다. 둘을 합치면
"에이전트는 끝났는데 사람은 아직 확인하지 않은" 구간이 사라지는데, 그 구간이
현재 누락된 단계다.

### 4.2 마이그레이션 / Migration

- 기존 티켓의 `cwd`를 git toplevel로 정규화해 레포/워크트리에 backfill한다.
- **정규화 없이 cwd를 그대로 키로 쓰면 같은 레포가 여러 개로 쪼개진다.**
  `Ticket.cwd`는 자유 문자열이며 워크트리 루트일 수도, 하위 디렉터리일 수도 있다.
- 해석에 실패한 런은 "미분류" 레포로 떨어뜨리고 크래시하지 않는다.

## 5. 공통 사이드바 / Shared Sidebar

**배치:** `App.tsx` 셸 레벨. 헤더 아래 좌측 고정 280px, 모든 `ViewMode`에서 동일.
접기는 기존 `leftPanelOpen` 토글을 재사용한다.
`views/unified/ProjectSidebar.tsx`는 이 컴포넌트로 대체 흡수하고 cwd basename
파생 로직은 폐기한다.

```
▾ claude-alive                    3 미종결
  ▾ main                    2
      ● #12 위임 모델 확장       ticket · running
      ◐ #11 훅 유실 조사        ticket · decision
  ▸ feat/unified-board      1
      ○ term-2               terminal · 미종결
▸ mpc-management            0
```

- 상태점: running(파랑) / waiting·decision(호박) / closed(회색) / failed(빨강).
- 워크트리 노드 배지는 **미종결 수**. 닫힌 런은 기본 접힘, "완료 N개 보기"로 펼침.

### 5.1 선택 모델 — 필터와 포커스 분리

| 클릭 대상 | 의미 | 결과 |
|---|---|---|
| 레포 / 워크트리 | 필터 | 중앙 뷰가 그 범위로 좁혀짐 |
| 런 | 포커스 | 중앙 뷰가 그 런을 염 |

뷰별 반응:
- `tickets` — 보드 레인이 필터 범위로 좁혀짐, 포커스 시 상세 모달
- `board` — 상세가 포커스된 런으로 전환
- `spread` — 해당 워크트리의 탭만 타일링, 포커스 시 해당 타일 활성
- `list` / `animation` / `workspace` — 필터 적용

필터·포커스는 URL 쿼리 + localStorage에 보존해 새로고침·뷰 전환에서 유지한다.

### 5.2 중복 제거

`views/board/WorkTab.tsx`의 좌측 `TicketList`는 공통 사이드바와 완전히 중복된다.
제거하고 우측 상세만 남긴다.

### 5.3 새 런의 진입점

워크트리 노드 hover 시 `+` → 런 종류 선택(티켓 / 터미널). cwd가 프리필된 상태로
`NewTicketForm` 또는 새 터미널 탭이 열린다. 현재는 티켓 생성 시 폴더를 매번
고르지만(`FolderPicker`), 사이드바에서 시작하면 레포·브랜치가 이미 확정된다.

### 5.4 미종결 회수 동선

사이드바 최상단에 `미종결 N · 가장 오래된 것 3일 전` 요약 줄. 클릭하면 미종결
런만 필터링한다. 닫지 않은 런이 계속 눈에 남는 것이 완결 추적의 실질적 장치다.

## 6. 런 카드와 닫기 플로우 / Run Card & Close Flow

현재 티켓 카드(`TicketCard`), 에이전트 카드(`ProjectSidebar`), 터미널 탭
(`TerminalTabBar`)이 각각 다른 모양이다. 하나의 `RunCard`로 통일한다.

```
┌────────────────────────────────────────┐
│ ● #12  위임 모델 12종 확장              │
│ main · opus · 4m 12s · $0.42           │
│ 12종 모두 등록, 폴백 경로 검증 완료      │
│                        [열기] [닫기]    │
└────────────────────────────────────────┘
```

- `kind`에 따라 메타 줄만 달라진다: ticket은 모델·비용, terminal은 탭 이름·경과,
  agent는 부모 세션.
- `RunCard`는 kind를 모르고 `RunView` 뷰모델만 받는다. 어댑터 3개가 각 소스를
  `RunView`로 사상한다.

### 6.1 닫기

1. `[닫기]` → **인라인** 한 줄 입력이 열린다(모달 아님).
2. 티켓 런은 `headline`이 프리필된다.
3. 저장 시 `outcome` + `closedAt` 기록, `state: closed`. WS 브로드캐스트로 전 뷰 갱신.
4. 결과 없이 닫으려면 `abandoned`(포기)를 선택해 완료와 구분한다.

**IME 가드 필수.** 한 줄 입력이 단독 Enter 제출이므로 `e.nativeEvent.isComposing`을
확인하지 않으면 한글 마지막 글자가 중복된다(기존 동일 버그 이력 있음).

### 6.2 닫힌 런의 정리

워크트리 노드 아래 "완료 N개"로 접힌다. 보드의 성과/품질/효율/과정 탭은 닫힌
런에서 진입하므로, 사후 분석이 "닫기"의 다음 단계로 이어진다.

## 7. 프리미티브 레이어 / Primitive Layer

### 7.1 토큰 보강 (`packages/ui/src/index.css`)

현재는 색상·폰트 변수만 있다. 다음을 추가한다.

```css
--space-1..6: 4 8 12 16 24 32px
--radius-sm/md/lg/xl: 6 8 12 16px
--text-xs/sm/base/lg/xl: 11 12 13 16 20px
--elev-1/2
--dur-fast/base: 120ms / 200ms
```

### 7.2 신설 `packages/ui/src/components/ui/`

| 컴포넌트 | 대체 대상 |
|---|---|
| `Panel` / `Card` | 뷰마다 반복되는 border+radius+bg 블록 |
| `Badge` | `ColumnHeader` 카운트 필, `views/list/promptBadges.tsx` |
| `Button` (primary/ghost/danger) | 전 뷰의 인라인 버튼 |
| `EmptyState` | `views/board/panels/EmptyState.tsx` 승격 + 각 뷰의 즉석 빈 상태 |
| `Tree` | 공통 사이드바, `WorkspaceTreeView` |
| `Tabs` | `BoardView`·`TicketDetailTabs`의 중복 탭 구현 |
| `StatusDot` | `views/tickets/ticketDisplay.ts`의 `STATUS_COLOR` 흡수 |

**규칙:** 신규 코드는 인라인 `style` 금지, 프리미티브만 사용한다. 기존 뷰는
손댈 때 하나씩 이관한다.

## 8. 컴포넌트 경계 / Components

신규:
- `packages/server/src/repoStore.ts` — 레포/워크트리 해석 + 캐시
- `packages/server/src/runStore.ts` — Run 레코드 CRUD + WS 브로드캐스트
- `packages/server/src/runAdapters/{ticket,terminal,agent}.ts` — 소스 → Run 미러링
- `packages/core/src/runs/types.ts` — `Repository`, `Worktree`, `Run`, `RunView`
- `packages/ui/src/components/RepoSidebar/` — 트리, 노드, 요약 줄
- `packages/ui/src/components/RunCard.tsx` — 단일 런 표현 + 닫기 인라인 입력
- `packages/ui/src/components/ui/` — 프리미티브 레이어
- `packages/ui/src/state/selection.ts` — 필터/포커스 리듀서 + 영속화

변경:
- `App.tsx` — 사이드바 셸 마운트, 선택 상태 소유
- `views/board/WorkTab.tsx` — 좌측 `TicketList` 제거
- `views/unified/ProjectSidebar.tsx` — 폐기(사이드바로 흡수)

## 9. 미결 사항 / Open Question

`hooks/useWorkspaceTree.ts`가 이미 트리를 다루고 있어 공통 사이드바와 개념이 겹친다.
3단계 착수 시점에 둘의 경계를 확정해야 한다.
- 안 1: 사이드바 = "런의 계층", workspace 트리 = "파일/세션의 계층"으로 역할 분리
- 안 2: workspace 트리를 사이드바에 흡수

이 결정은 사이드바 신설(단계 3) 전에는 내리지 않으며, 그 전 단계들은 이 선택과
무관하게 진행 가능하다.

## 10. 단계 / Phases

각 단계는 독립적으로 배포 가능하다.

1. 토큰 + 프리미티브 레이어 — 뷰 변경 0, 시각 회귀 0
2. `repoStore` / `runStore` + git 해석 + 어댑터 3개 + WS 메시지
3. 공통 사이드바 신설, `ProjectSidebar` 대체
4. 필터/포커스 배선 — tickets → board → spread → list/animation/workspace 순
5. `RunCard` + 닫기 플로우
6. `WorkTab`의 중복 `TicketList` 제거

## 11. 테스트 / Testing

순수 로직 우선(모두 단위 테스트 가능):
- cwd → repoId 정규화, 워크트리/브랜치 해석
- `RunView` 어댑터 3종
- 필터/포커스 리듀서 + 영속화

컴포넌트:
- 사이드바 트리 렌더·접기·미종결 배지 카운트
- 닫기 플로우(프리필, abandoned 분기, IME 조합 가드)

기존 테스트 영향:
- `__tests__/viewGroups.test.ts` — nav 유지이므로 무영향
- `views/board/__tests__/{BoardView,WorkTab}.test.tsx` — 단계 6에서 갱신

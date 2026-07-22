# 티켓 중심 IA 재편 (Ticket-Centric Information Architecture) — 설계

- **날짜**: 2026-07-22
- **브랜치**: `feat/ticket-centric-restructure` (baseline: `feat/p0-canonical-contracts` 커밋 `22c4c2b`)
- **범위**: 전체 비전의 하위 프로젝트 **A** (IA 재편). 하위 프로젝트 C(평가·품질 시스템)는 별도 스펙.

## 1. 배경 / 문제

현재 `HeaderBar`는 목적이 다른 **8개 뷰를 하나의 평면 세그먼트 컨트롤**에 동등한 무게로 나열한다:

```
[애니메이션] [리스트] [프롬프트] [efficio] [아카이브] [티켓] [스프레드] [워크스페이스]
```

기본 진입 뷰는 `animation`. 사용자는 매 진입마다 "관찰/작업/자산/분석" 성격이 섞인 8개 중에서 골라야 한다.

### 지향하는 사용 모델 (사용자 정의)

티켓을 **메인**으로 쓴다. 티켓을 발행하면 에이전트가 자율로 처리하고, 해결되거나 문제로 종료된다. 사용자는 **터미널을 볼 필요 없이** 원격으로 업무지시·문제해결·결과보고를 받는다. 자세한 가이드가 필요하거나 문제가 생겼을 때만 애니메이션(터미널)/스프레드/리스트로 **직접 들어가 개입**한다. 워크스페이스/프롬프트/efficio는 생산성 목적의 **별개 기능**으로 분리해 관리한다.

## 2. 목표 / 비목표

**목표**
- 티켓을 1급(primary) 표면·기본 진입 뷰로 승격한다.
- 관찰/개입 뷰(애니메이션·리스트·스프레드)를 "필요할 때 빠르게 들어가는" 보조 그룹으로 재배치한다.
- 생산성 도구(워크스페이스·프롬프트·efficio·아카이브)를 별도 그룹으로 분리해 주 네비게이션에서 시각적으로 강등한다.
- 티켓에서 그 티켓의 실행 세션으로 **직접 점프(개입)** 하는 동선을 만든다.

**비목표 (이번 A안에서 하지 않음)**
- 뷰 내부 기능 변경(애니메이션 렌더링, 스프레드 로직 등)은 건드리지 않는다.
- 평가·품질 시스템(C)·oneshot classification은 별도 스펙.
- 뷰를 삭제하지 않는다. 재배치·강등만 한다(가역적).

## 3. 정보구조 (3계층)

빈도 기반 위계:

| 계층 | 그룹 | 멤버 | 사용 빈도 | 헤더 표현 |
|---|---|---|---|---|
| 1 (Primary) | **티켓** | tickets | 항상 | 강조된 단독 탭 (좌측) |
| 2 (개입) | **개입** | animation, list, spread | 가끔(문제 시 빠르게) | 보이는 세그먼트 pill 그룹 |
| 3 (도구) | **도구** | workspace, prompt, efficio, archive | 드묾(별도 관리) | `도구 ▾` 드롭다운 |

근거: 개입은 "문제 발생 시 즉시" 필요하므로 한 번 클릭으로 닿아야 한다(가시 pill). 도구는 "별도 관리"이므로 드롭다운으로 접어 헤더를 비운다.

### 헤더 레이아웃

```
claude-alive ◇  |  [ 티켓 ]  ‖  개입: [애니메이션][리스트][스프레드]  ‖  [ 도구 ▾ ]        ...우측: CPU/RAM·알림·언어·패널·설정
```

- `‖` = 얇은 divider.
- 티켓 버튼은 accent 배경으로 강조(현재 active 스타일 재사용).
- "개입" 그룹은 라벨 + 3-pill 세그먼트. active 멤버만 강조.
- "도구" 드롭다운: 클릭 시 workspace/prompt/efficio/archive 항목 리스트. 현재 active가 도구 그룹이면 버튼에 표시(예: `도구 · Efficio`).

## 4. 컴포넌트 설계

### 4.1 `ViewMode` / 그룹 메타 (신규: `viewGroups.ts`)

`App.tsx`의 `ViewMode` 유니온은 유지. 그룹 분류를 단일 출처로 추출한다.

```ts
// packages/ui/src/components/viewGroups.ts
export type ViewGroup = 'primary' | 'intervene' | 'tools';
export interface ViewModeMeta { mode: ViewMode; labelKey: string; group: ViewGroup; }
export const VIEW_MODE_META: ViewModeMeta[] = [
  { mode: 'tickets',   labelKey: 'viewMode.tickets',   group: 'primary'   },
  { mode: 'animation', labelKey: 'viewMode.animation', group: 'intervene' },
  { mode: 'list',      labelKey: 'viewMode.list',      group: 'intervene' },
  { mode: 'spread',    labelKey: 'viewMode.spread',    group: 'intervene' },
  { mode: 'workspace', labelKey: 'viewMode.workspace', group: 'tools'     },
  { mode: 'prompt',    labelKey: 'viewMode.prompt',    group: 'tools'     },
  { mode: 'efficio',   labelKey: 'viewMode.efficio',   group: 'tools'     },
  { mode: 'archive',   labelKey: 'viewMode.archive',   group: 'tools'     },
];
```

- `jarvis`는 현재 헤더에 노출되지 않으므로 메타에서도 제외(기존과 동일).
- 단위 책임: "어떤 뷰가 어느 그룹인가"의 유일한 출처. HeaderBar는 이걸 렌더만 한다.

### 4.2 `HeaderBar` 재구성

- 기존 `VIEW_MODES` 평면 배열 → `VIEW_MODE_META`를 `group`별로 분할해 렌더.
- 3개 하위 렌더: `PrimaryTab`, `InterveneGroup`(pill 세그먼트), `ToolsMenu`(드롭다운).
- `ToolsMenu`는 로컬 `open` 상태 + 바깥 클릭 닫기. 키보드 접근성(Esc 닫기, 화살표 이동은 후속).
- 접근성: `role="tablist"` 유지, 그룹 라벨은 `aria-label`.

### 4.3 기본 진입 뷰

`App.tsx`: `useState<ViewMode>('animation')` → `useState<ViewMode>('tickets')`. `prevViewRef` 초기값도 `'tickets'`.

### 4.4 티켓 → 개입 동선

`TicketDetailModal`에 "과정 보기 / 개입" 액션 추가.

- 노출 조건: `ticket.claudeSessionId`가 있을 때(활성/실패 티켓에서 주로 존재).
- 클릭 시:
  ```ts
  window.dispatchEvent(new CustomEvent('claude-alive:navigate', { detail: { mode: 'animation' } }));
  window.dispatchEvent(new CustomEvent('terminal:focusTab', { detail: { sessionId: ticket.claudeSessionId } }));
  onClose();
  ```
- 두 이벤트 핸들러는 `App.tsx`에 **이미 존재**(`onNavigate`, `onFocus`) → 신규 배선 없음.
- 라벨 i18n: `tickets.intervene`("과정 보기 / 개입" / "Inspect / intervene").

## 5. 데이터 흐름

신규 서버/프로토콜 변경 없음. 전부 UI 로컬:

```
TicketDetailModal ─(claude-alive:navigate + terminal:focusTab)→ App
   App: setViewMode('animation') + setSelectedSessionId(sid) + setChatOpen(true)
   → 해당 세션의 터미널/픽셀 캐릭터가 포커스된 상태로 개입 화면 진입
```

## 6. 오류 처리 / 엣지

- `claudeSessionId` 없는 티켓: 개입 버튼 숨김(있는 세션만 점프 가능).
- 포커스 대상 세션이 이미 종료: 기존 `terminal:focusTab` 동작을 따름(신규 예외 처리 불필요, 회귀만 확인).
- 도구 드롭다운 열린 채 뷰 전환: 선택 즉시 닫힘.

## 7. 테스트

- **단위**: `viewGroups.ts` — 각 뷰가 기대 그룹에 매핑되는지, 8개 뷰 모두 정확히 한 그룹에 속하는지(누락/중복 0).
- **컴포넌트**: HeaderBar 렌더 시 티켓=primary, 개입 3-pill, 도구 드롭다운 항목 4개 존재; 도구 항목 클릭 → `onViewModeChange` 호출.
- **회귀**: 기존 102개 테스트 전부 통과 유지. `tsc --noEmit` 클린.
- (E2E는 이번 범위 밖 — 후속.)

## 8. i18n

신규 키(ko/en):
- `viewMode.groupIntervene`: "개입" / "Intervene"
- `viewMode.groupTools`: "도구" / "Tools"
- `tickets.intervene`: "과정 보기 / 개입" / "Inspect / intervene"

## 9. 구현 단계

1. `viewGroups.ts` + 단위 테스트 (RED→GREEN).
2. `HeaderBar` 3그룹 렌더로 재구성 + i18n 키.
3. `App.tsx` 기본 뷰 `tickets`로 변경.
4. `TicketDetailModal` 개입 액션 + i18n 키.
5. 회귀(tsc + vitest) → 커밋.

각 단계 후 tsc/test 검증. 가역적(뷰 삭제 없음)이라 롤백 안전.

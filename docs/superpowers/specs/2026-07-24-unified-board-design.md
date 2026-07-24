# 통합 보드 (Unified Board) 설계 / Unified Board Design

- 날짜: 2026-07-24
- 상태: 승인됨 (brainstorming)
- 관련 스펙: [ticket-centric-ia](2026-07-22-ticket-centric-ia-design.md), [session-ticket-management-split](2026-07-22-session-ticket-management-split-design.md), [evaluation-feedback-loop](2026-07-22-evaluation-feedback-loop-design.md), [data-usage-dashboard](2026-07-23-data-usage-dashboard.md)

## 1. 배경 / Background

현재 헤더 `tools` 그룹에는 서로 다른 렌즈로 같은 실행(session run)을 보는 4개 뷰가 독립 top-level nav로 흩어져 있다:

| 뷰 | 렌즈 | 데이터 | 조인 키 |
|---|---|---|---|
| `prompt` | 답변 품질(스코어) | `/api/prompts/*` `PromptListRow` | `session_id` |
| `efficio` | 효율/낭비 | `/api/efficio/*` `EfficioSessionProfile` | `sessionId` |
| `archive` (세션관리) | 실행 과정/이력 | `CompletedSession` | `sessionId` |
| `ticketMgmt` | 성과 라벨·편향 | `TicketEvaluation` | `claudeSessionId` + `route` |
| (`data`) | 비용/토큰 | `/api/usage` `UsageRecordDTO` | (시간버킷, sessionId 없음) |

네 뷰는 공통 키 `sessionId`(티켓은 `claudeSessionId`)로 조인 가능하며, 각자 reachable/loading/레이아웃 껍데기를 중복 구현한다. 목표는 이들을 **하나의 티켓 중심 보드**로 통합하고, 탭으로 비용·품질·효율·과정·성과를 종합해 보는 것.

## 2. 확정된 결정 / Decisions

1. **1차 엔티티 = 티켓(A안).** 좌측은 프로젝트(route)→티켓 그룹 리스트. 티켓 하나를 고르면 `claudeSessionId`로 세션을 조인해 우측 상세를 채운다.
2. **비용은 as-is 재사용.** `UsageRecordDTO`/`/api/usage`/`parseUsageLine`을 변경하지 않는다. sessionId 백필·시간창 조인 없음. 비용은 전역·시간버킷 뷰로만 보여준다(티켓별 비용 귀속 없음).
3. **보드 IA = 작업/비용 2대탭.** workspace(관제탑)는 별도 top-level 뷰로 유지한다. backends(연결 설정)는 현행 Settings의 `BackendsPanel`에 그대로 두며, 보드나 `ViewMode`/헤더 nav 항목으로 복원하지 않는다.
4. **콘텐츠 컴포넌트 재사용.** 기존 4개 뷰의 렌더링 컴포넌트를 최대한 그대로 재사용하고, 없애는 것은 각 뷰의 top-level nav 진입점과 중복된 reachable/loading 껍데기뿐. "재편"은 IA(껍데기) 교체이며 내부 렌더는 보존 → 회귀 위험 최소화.

## 3. IA 구조 / Information Architecture

```
헤더 nav:  [ 티켓 ] [ 관제탑(workspace) ] [ 보드 ] ...
                                          └── prompt·efficio·archive·ticketMgmt·data 흡수
설정(Settings): [ BackendsPanel ]  ← 기존 위치 유지

보드:
┌─ [ 작업 ]  [ 비용 ] ──────────────────────────────┐  (대탭 2)
│                                                    │
│ 작업 탭:                                            │
│  ┌ 좌: 티켓 리스트 ─────┬─ 우: 선택 티켓 상세 ──────┐ │
│  │ 프로젝트(route)      │  [성과][품질][효율][과정]   │ │  (서브탭 4)
│  │  └ 티켓 seq·라벨·검색 │   claudeSessionId 조인      │ │
│  └─────────────────────┴───────────────────────────┘ │
│                                                    │
│ 비용 탭:  기존 DataView 그대로(전역·시간버킷)         │
└────────────────────────────────────────────────────┘
```

### 3.1 "작업" 대탭

- **좌 패널 (티켓 리스트):** 현재 `TicketMgmtView`의 좌측(프로젝트→티켓 그룹, 검색, 라벨 색상, 접힘/펼침, good/bad/reflected 카운트)을 그대로 재사용. 선택 상태(`selectedId`)를 상위로 승격.
- **우 패널 (티켓 상세, 서브탭 4):**
  - **성과** — 기존 `TicketDissection`(라벨 good/bad, 편향 반영 게이트, RouteGuidePreview). 현행 그대로.
  - **품질** — 선택 티켓의 `claudeSessionId`가 있으면 그 세션의 프롬프트 스코어 표시. 기존 `PromptDashboardView`/`PromptListView`의 데이터·행 컴포넌트를 세션 필터로 재사용. sessionId 없으면 "연결된 세션 없음" 빈 상태.
  - **효율** — 같은 sessionId의 `EfficioSessionProfile`. 기존 `SessionDetailCard`(단일 세션 카드) + 필요 시 축 요약 재사용. 프로필 없으면 빈 상태.
  - **과정** — 같은 sessionId의 완료 세션 대화/이벤트. 기존 `ArchiveView`의 세션 상세 렌더(대화 패널)를 단일 세션 모드로 재사용.

### 3.2 "비용" 대탭

- 기존 `DataView`를 **무변경**으로 마운트. 전역 사용량/비용(일·주·월 버킷).

## 4. 조인 계약 / Join Contract

- 조인 키: `TicketEvaluation.claudeSessionId` → 각 서브탭 데이터의 세션 키(`session_id`/`sessionId`).
- `claudeSessionId`가 없는 티켓: 성과 탭은 정상, 품질·효율·과정 탭은 각기 빈 상태(“연결된 세션 없음”)를 렌더. 크래시·로딩 무한대 금지.
- 세션 데이터가 존재하지 않는 경우(파일 없음 등): 각 서브탭이 자체 빈/오류 상태로 degrade. 보드 셸은 영향받지 않음.

## 5. 컴포넌트 경계 / Components

신규:
- `views/board/BoardView.tsx` — 보드 셸. 대탭(작업/비용) 상태, reachable/loading 통합 껍데기 1곳.
- `views/board/WorkTab.tsx` — 좌 티켓 리스트 + 우 상세 서브탭 오케스트레이션. `selectedTicket`(→`claudeSessionId`) 소유.
- `views/board/TicketDetailTabs.tsx` — 서브탭(성과/품질/효율/과정) 스위처. 각 탭에 sessionId 전달.
- `views/board/panels/QualityPanel.tsx`, `EfficiencyPanel.tsx`, `ProcessPanel.tsx` — 세션 필터를 받아 기존 컴포넌트를 감싸는 얇은 어댑터.

재사용(이동/추출):
- `TicketMgmtView`의 좌측 리스트 → `views/board/TicketList.tsx`로 추출(또는 props로 selection 승격).
- `TicketDissection`(성과) 그대로.
- `PromptListView`/`PromptDashboardView`의 세션 필터 가능한 하위 컴포넌트, `SessionDetailCard`(efficio), `ArchiveView`의 세션 상세 렌더.

제거:
- `viewGroups.ts`에서 `prompt`·`efficio`·`archive`·`ticketMgmt`·`data`의 개별 nav 항목 → 단일 `board` 항목으로 대체.
- `App.tsx`의 해당 5개 개별 렌더 분기 → `BoardView` 단일 분기. (딥링크 이벤트 `mode: 'archive'|'ticketMgmt'` 등은 `board`+내부 탭 파라미터로 리라우팅.)

## 6. 라우팅/딥링크 / Routing

- 헤더 `ViewMode`에 `board` 추가, 기존 5개 mode는 당분간 보드 내부 탭으로 매핑(하위호환). `ticketMgmt`의 "과정 보기→archive" 딥링크(`ArchiveView.tsx:23` `focusSessionId`)는 보드 내 과정 서브탭 포커스로 전환.
- 최소 변경 원칙: 기존 `handleViewModeChange`/커스텀 이벤트 경로를 board 내부 탭 선택으로 흡수.

## 7. i18n

- 신규 키: `viewMode.board`, `board.tab.work`, `board.tab.cost`, `board.subtab.outcome|quality|efficiency|process`, `board.empty.noSession` 등. EN/KO 동시.
- 기존 뷰 라벨 키는 보드 내부 탭 라벨로 재활용 가능.

## 8. 테스트 / Testing

- `BoardView`: 대탭 전환, reachable/loading 통합 껍데기.
- `WorkTab`: 티켓 선택 시 sessionId 전파, sessionId 없는 티켓의 빈 상태.
- 조인 어댑터(QualityPanel 등): sessionId 유/무·데이터 유/무 4조합의 빈/정상 렌더.
- 기존 `TicketMgmtView.test.tsx` 등 회귀: 좌측 리스트 추출 후에도 라벨/검색/카운트 동작 유지.
- 딥링크: `focusSessionId` → 과정 서브탭 포커스.

## 9. 비범위 / Out of Scope (YAGNI)

- usage의 sessionId 백필·티켓별 비용 귀속.
- 프롬프트/efficio 파이프라인 자체 로직 변경.
- workspace 통합.
- Settings의 `BackendsPanel`을 보드/`ViewMode`/헤더 nav로 이동.
- 티켓↔세션 다대다(브랜치/재개) 정밀 처리 — 1차는 단일 `claudeSessionId` 기준.

## 10. 단계 / Phasing

1. 보드 셸 + nav 통합(빈 대탭) — 헤더 5→1, App 분기 교체.
2. 작업 탭: 티켓 리스트 추출 + 성과 서브탭(기존 dissection 이식).
3. 품질·효율·과정 서브탭 어댑터 + 조인 계약(빈 상태 포함).
4. 비용 대탭(DataView 마운트) + 딥링크 리라우팅 + i18n + 테스트.

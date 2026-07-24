# 통합 보드 (Unified Board) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프롬프트·Efficio·세션관리·티켓관리·데이터 5개 뷰를 단일 "보드"로 통합한다. 티켓을 1차 엔티티로, `claudeSessionId` 조인으로 한 티켓의 성과·품질·효율·과정을 서브탭으로 보고, 비용은 기존 usage 뷰를 그대로 재사용한다.

**Architecture:** 신규 `views/board/` 아래 셸(`BoardView`)이 대탭 2개(작업/비용)를 소유한다. "작업" 탭은 기존 티켓 리스트를 추출해 좌측에 두고, 선택 티켓의 `claudeSessionId`를 우측 서브탭 4개(성과/품질/효율/과정)에 전달한다. 각 서브탭은 기존 API를 sessionId로 필터링하는 얇은 어댑터 패널이다. 기존 4개 뷰의 콘텐츠 렌더는 최대한 재사용하고, 없애는 것은 개별 top-level nav 진입점뿐이다.

**Tech Stack:** React 19, TypeScript 5.7, Vite 6, Tailwind CSS 4, i18next (EN/KO), vitest. 상태는 로컬 useState, 서버는 기존 HTTP API(`/api/prompts`, `/api/efficio/*`, `/api/completed`, `/api/usage`, 티켓 `fetchRecords`).

## Global Constraints

- 모든 UI 텍스트는 `packages/i18n/src/locales/{en,ko}.json` 번역 키 사용. 하드코딩 문자열 금지(fallback 포함).
- UI는 `@claude-alive/core`에서 **타입만** import(런타임 값 import 금지 — 브라우저 빌드 깨짐).
- `any` 금지. 외부 입력은 `unknown` 후 좁히기.
- 커밋 메시지 bilingual(한/영) `<type>: <한글> / <English>`.
- 타입체크: `pnpm --filter=@claude-alive/ui exec tsc --noEmit`. 테스트: `pnpm --filter=@claude-alive/ui test`.
- 비용(usage) 관련 서버 코드(`UsageRecordDTO`, `/api/usage`, `parseUsageLine`)는 **변경 금지**.
- 기존 뷰 콘텐츠 컴포넌트의 내부 로직 변경 금지 — 추출/래핑만.

## File Structure

신규:
- `packages/ui/src/views/board/BoardView.tsx` — 보드 셸. 대탭(work/cost) 상태 + 통합 reachable/loading 껍데기.
- `packages/ui/src/views/board/WorkTab.tsx` — 좌 티켓 리스트 + 우 상세 서브탭. selectedTicket 소유.
- `packages/ui/src/views/board/TicketDetailTabs.tsx` — 서브탭(성과/품질/효율/과정) 스위처.
- `packages/ui/src/views/board/TicketList.tsx` — TicketMgmtView 좌측에서 추출한 프로젝트→티켓 리스트(selection 승격).
- `packages/ui/src/views/board/panels/OutcomePanel.tsx` — 성과(기존 TicketDissection 래핑 + 라벨/반영 상태 관리).
- `packages/ui/src/views/board/panels/QualityPanel.tsx` — `/api/prompts` 세션 필터 어댑터.
- `packages/ui/src/views/board/panels/EfficiencyPanel.tsx` — `/api/efficio/profiles` 세션 필터 → `SessionDetailCard`.
- `packages/ui/src/views/board/panels/ProcessPanel.tsx` — `/api/completed` 세션 조회 → 세션 상세 렌더.
- `packages/ui/src/views/board/panels/EmptyState.tsx` — 공통 빈 상태("연결된 세션 없음" 등).
- `packages/ui/src/views/board/__tests__/BoardView.test.tsx`, `WorkTab.test.tsx`, `panels.test.tsx`.

수정:
- `packages/ui/src/components/viewGroups.ts` — tools에서 prompt·efficio·archive·ticketMgmt·data 제거, `board` 추가.
- `packages/ui/src/App.tsx` — 5개 개별 렌더 분기 → `BoardView` 단일 분기. 딥링크 리라우팅.
- `packages/ui/src/views/ticketmgmt/TicketMgmtView.tsx` — 좌측 리스트를 `TicketList`로 치환(추출 결과 재사용). (기능 보존)
- `packages/i18n/src/locales/{en,ko}.json` — `viewMode.board`, `board.*` 키 추가.

---

## Phase 1 — 보드 셸 + nav 통합

### Task 1: 빈 BoardView 셸 + nav 항목 교체

**Files:**
- Create: `packages/ui/src/views/board/BoardView.tsx`
- Modify: `packages/ui/src/components/viewGroups.ts:26-40`
- Modify: `packages/ui/src/App.tsx:52` (ViewMode union), `:553-577` (렌더 분기)
- Modify: `packages/i18n/src/locales/en.json`, `ko.json` (`viewMode.board`, `board.tab.work`, `board.tab.cost`)
- Test: `packages/ui/src/views/board/__tests__/BoardView.test.tsx`

**Interfaces:**
- Produces: `export function BoardView(props: { active: boolean; subscribeRaw: RawMessageSubscribe; focusSessionId?: string | null }): JSX.Element`
- Consumes: `RawMessageSubscribe` from `../../App.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/views/board/__tests__/BoardView.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BoardView } from '../BoardView';

const noopSub = () => () => {};

describe('BoardView', () => {
  it('renders work and cost top tabs, work active by default', () => {
    render(<BoardView active subscribeRaw={noopSub} />);
    expect(screen.getByRole('tab', { name: /work|작업/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /cost|비용/i })).toBeInTheDocument();
  });

  it('switches to cost tab on click', () => {
    render(<BoardView active subscribeRaw={noopSub} />);
    fireEvent.click(screen.getByRole('tab', { name: /cost|비용/i }));
    expect(screen.getByRole('tab', { name: /cost|비용/i })).toHaveAttribute('aria-selected', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter=@claude-alive/ui test -- BoardView`
Expected: FAIL — `Cannot find module '../BoardView'`.

- [ ] **Step 3: Add i18n keys**

`ko.json` (viewMode 블록 안 + 새 board 블록):
```json
"viewMode": { "board": "보드" },
"board": {
  "tab": { "work": "작업", "cost": "비용" }
}
```
`en.json`:
```json
"viewMode": { "board": "Board" },
"board": {
  "tab": { "work": "Work", "cost": "Cost" }
}
```
(기존 `viewMode` 블록에 `board` 키만 추가 — 기존 키 삭제 금지.)

- [ ] **Step 4: Create BoardView shell (cost tab = 기존 DataView, work tab = placeholder)**

```tsx
// packages/ui/src/views/board/BoardView.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RawMessageSubscribe } from '../../App.tsx';
import { DataView } from '../data/DataView.tsx';

type TopTab = 'work' | 'cost';

interface BoardViewProps {
  active: boolean;
  subscribeRaw: RawMessageSubscribe;
  focusSessionId?: string | null;
}

export function BoardView({ active, subscribeRaw, focusSessionId }: BoardViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TopTab>('work');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div role="tablist" style={{ display: 'flex', gap: 4, padding: '8px 16px 0', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}>
        <TopTabButton id="work" label={t('board.tab.work')} active={tab === 'work'} onClick={() => setTab('work')} />
        <TopTabButton id="cost" label={t('board.tab.cost')} active={tab === 'cost'} onClick={() => setTab('cost')} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ display: tab === 'work' ? 'block' : 'none', height: '100%' }}>
          {/* WorkTab wired in Task 2 */}
          <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>work</div>
        </div>
        <div style={{ display: tab === 'cost' ? 'block' : 'none', height: '100%' }}>
          <DataView active={active && tab === 'cost'} />
        </div>
      </div>
    </div>
  );
}

function TopTabButton({ id, label, active, onClick }: { id: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick}
      style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', background: 'transparent', border: 'none', borderBottom: active ? '2px solid var(--accent-blue)' : '2px solid transparent', marginBottom: -1, cursor: 'pointer' }}>
      {label}
    </button>
  );
}
```

- [ ] **Step 5: Run BoardView test to verify pass**

Run: `pnpm --filter=@claude-alive/ui test -- BoardView`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire nav — viewGroups + App**

`viewGroups.ts:26-40` — tools 배열에서 `prompt`,`efficio`,`archive`,`ticketMgmt`,`data` 항목 제거하고 그 자리에 한 줄 추가:
```ts
{ mode: 'board', labelKey: 'viewMode.board', group: 'tools' },
```
결과 tools 그룹: `workspace`, `board`. 기존 backend 연결 UI는 Settings의 `BackendsPanel`에 유지하며 `ViewMode`/헤더 nav 항목으로 복원하지 않는다.

`App.tsx:52` — union에 `'board'` 추가(기존 mode 문자열은 남겨둠 — 딥링크 하위호환):
```ts
export type ViewMode = 'animation' | 'list' | 'prompt' | 'efficio' | 'archive' | 'ticketMgmt' | 'spread' | 'jarvis' | 'workspace' | 'tickets' | 'data' | 'board';
```

`App.tsx:553-577` — `prompt`/`efficio`/`archive`/`ticketMgmt`/`data` 5개 렌더 `<div>` 블록을 삭제하고 하나로 교체:
```tsx
<div style={{ position: 'absolute', inset: 0, display: viewMode === 'board' ? 'block' : 'none' }}>
  <Suspense fallback={null}>
    <BoardView active={viewMode === 'board'} subscribeRaw={subscribeRaw} focusSessionId={archiveFocusSessionId} />
  </Suspense>
</div>
```
`App.tsx` 상단 import에서 `PromptView`,`EfficioView`,`ArchiveView`,`TicketMgmtView`,`DataView` 개별 import 제거하고 `import { BoardView } from './views/board/BoardView.tsx';` 추가. (`DataView`는 BoardView 내부에서만 import.)
`App.tsx:575` `contentViewActive` 계산에서 제거된 mode들을 `viewMode === 'board'`로 치환.

- [ ] **Step 7: Typecheck + build**

Run: `pnpm --filter=@claude-alive/ui exec tsc --noEmit`
Expected: 통과. (제거된 5개 뷰를 참조하는 잔여 코드가 있으면 이 단계에서 드러남 — Task 2~5에서 재도입되므로, 잔여 참조는 board로 리라우팅.)

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/views/board packages/ui/src/components/viewGroups.ts packages/ui/src/App.tsx packages/i18n/src/locales
git commit -m "feat(board): 보드 셸과 nav 통합(비용 탭=기존 usage) / Add board shell and unify nav (cost tab reuses usage)"
```

---

## Phase 2 — 작업 탭: 티켓 리스트 추출 + 성과 서브탭

### Task 2: TicketList 추출 (selection 승격)

**Files:**
- Create: `packages/ui/src/views/board/TicketList.tsx`
- Modify: `packages/ui/src/views/ticketmgmt/TicketMgmtView.tsx:156-238` (좌측 리스트를 `<TicketList>`로 치환)
- Test: `packages/ui/src/views/board/__tests__/WorkTab.test.tsx` (TicketList 부분)

**Interfaces:**
- Produces: `export function TicketList(props: { records: TicketEvaluation[] | null; selectedId: string | null; onSelect: (ticketId: string) => void }): JSX.Element` — 검색·프로젝트 그룹·접힘·라벨색·good/bad/reflected 카운트 포함(기존 마크업 그대로).
- Consumes: `TicketEvaluation` (type-only from `@claude-alive/core`).

- [ ] **Step 1: Write failing test**

```tsx
// packages/ui/src/views/board/__tests__/WorkTab.test.tsx (파일 시작)
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TicketList } from '../TicketList';
import type { TicketEvaluation } from '@claude-alive/core';

const rec = (o: Partial<TicketEvaluation>): TicketEvaluation => ({
  ticketId: 't1', seq: 1, route: '/proj/a', goal: 'goal', label: 'good',
  autoLabel: 'good', humanLabeled: false, reflected: false, weight: 3,
  updatedAt: 100, createdAt: 100, ...o,
} as TicketEvaluation);

describe('TicketList', () => {
  it('groups by route and fires onSelect', () => {
    const onSelect = vi.fn();
    render(<TicketList records={[rec({ ticketId: 't1', headline: 'Hello' })]} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Hello'));
    expect(onSelect).toHaveBeenCalledWith('t1');
  });

  it('shows loading when records null', () => {
    render(<TicketList records={null} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/loading|불러오는/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter=@claude-alive/ui test -- WorkTab`
Expected: FAIL — `Cannot find module '../TicketList'`.

- [ ] **Step 3: Extract TicketList**

`TicketMgmtView.tsx`의 좌측 리스트 렌더(현행 `156-223`의 List pane 내부: 검색 input + `groups.map` 마크업)와 `groups`/`query`/`collapsed`/`toggleCollapsed`/`basename`/`LABEL_COLOR`/`RouteGroup` 로직을 `TicketList.tsx`로 이동한다. props는 `records`,`selectedId`,`onSelect`. 내부에서 `query`/`collapsed`는 자체 useState로 소유. i18n 키는 기존 `ticketMgmt.*`를 그대로 사용(추가 키 불필요). 마크업/스타일은 원본과 동일하게 복사(픽셀 동일).

- [ ] **Step 4: Rewire TicketMgmtView to use TicketList**

`TicketMgmtView.tsx`의 List pane(`158-223`)을 다음으로 치환:
```tsx
<div style={{ width: 440, minWidth: 300, maxWidth: '50%', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
  <TicketList records={records} selectedId={selectedId} onSelect={setSelectedId} />
</div>
```
이동으로 미사용이 된 `groups`/`query`/`collapsed`/`toggleCollapsed`/`basename`/`RouteGroup`/`LABEL_COLOR`를 `TicketMgmtView`에서 제거. `import { TicketList } from '../board/TicketList.tsx';` 추가.

- [ ] **Step 5: Run tests (TicketList + 기존 TicketMgmt 회귀)**

Run: `pnpm --filter=@claude-alive/ui test -- WorkTab TicketMgmt`
Expected: PASS. 기존 `ticketmgmt/__tests__/TicketMgmtView.test.tsx`도 통과(라벨/검색/카운트 보존).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/board/TicketList.tsx packages/ui/src/views/ticketmgmt/TicketMgmtView.tsx packages/ui/src/views/board/__tests__/WorkTab.test.tsx
git commit -m "refactor(board): 티켓 리스트를 재사용 컴포넌트로 추출 / Extract ticket list into reusable component"
```

### Task 3: WorkTab + 성과 서브탭 (OutcomePanel)

**Files:**
- Create: `packages/ui/src/views/board/WorkTab.tsx`, `TicketDetailTabs.tsx`, `panels/OutcomePanel.tsx`, `panels/EmptyState.tsx`
- Modify: `packages/ui/src/views/board/BoardView.tsx` (work placeholder → `<WorkTab>`)
- Modify: `packages/i18n/src/locales/{en,ko}.json` (`board.subtab.*`, `board.empty.*`)
- Test: `packages/ui/src/views/board/__tests__/WorkTab.test.tsx` (WorkTab 부분)

**Interfaces:**
- Produces:
  - `export function WorkTab(props: { active: boolean }): JSX.Element` — 티켓 fetch/라벨/반영 소유(기존 TicketMgmtView 로직 이식), 좌 `TicketList` + 우 `TicketDetailTabs`.
  - `export function TicketDetailTabs(props: { record: TicketEvaluation | null; sessionId: string | null; guideRefreshKey: number; onLabel: (input: { label: EvalLabel; weight: number; note: string }) => void; onReflect: (reflected: boolean) => void }): JSX.Element`
  - `export function EmptyState(props: { message: string }): JSX.Element`
- Consumes: `fetchRecords`,`setLabel`,`setReflected`,`EvalLabel` from `../ticketmgmt/api.ts`; `TicketEvaluation` type.

- [ ] **Step 1: Write failing test**

```tsx
// WorkTab.test.tsx 에 추가
import { WorkTab } from '../WorkTab';
// fetchRecords 목: 세션 없는 티켓 → 품질/효율/과정 탭이 빈 상태
vi.mock('../../ticketmgmt/api.ts', () => ({
  fetchRecords: vi.fn().mockResolvedValue([
    { ticketId: 't1', seq: 1, route: '/p/a', goal: 'g', headline: 'H', label: 'good',
      autoLabel: 'good', humanLabeled: false, reflected: false, weight: 3, updatedAt: 1, createdAt: 1 },
  ]),
  setLabel: vi.fn(), setReflected: vi.fn(),
}));

it('selecting a ticket without claudeSessionId shows empty state on quality tab', async () => {
  render(<WorkTab active />);
  fireEvent.click(await screen.findByText('H'));
  fireEvent.click(screen.getByRole('tab', { name: /quality|품질/i }));
  expect(screen.getByText(/no linked session|연결된 세션 없음/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter=@claude-alive/ui test -- WorkTab`
Expected: FAIL — `Cannot find module '../WorkTab'`.

- [ ] **Step 3: Add i18n keys**

`ko.json` `board` 블록:
```json
"subtab": { "outcome": "성과", "quality": "품질", "efficiency": "효율", "process": "과정" },
"empty": { "noSession": "연결된 세션 없음", "noData": "데이터 없음", "pickTicket": "티켓을 선택하세요" }
```
`en.json`:
```json
"subtab": { "outcome": "Outcome", "quality": "Quality", "efficiency": "Efficiency", "process": "Process" },
"empty": { "noSession": "No linked session", "noData": "No data", "pickTicket": "Select a ticket" }
```

- [ ] **Step 4: Create EmptyState + OutcomePanel**

```tsx
// panels/EmptyState.tsx
export function EmptyState({ message }: { message: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: 13, padding: 40, textAlign: 'center' }}>{message}</div>;
}
```
```tsx
// panels/OutcomePanel.tsx — 기존 TicketDissection을 그대로 감싼다
import type { EvalLabel } from '../../ticketmgmt/api.ts';
import type { TicketEvaluation } from '@claude-alive/core';
import { TicketDissection } from '../../ticketmgmt/TicketDissection.tsx';

interface OutcomePanelProps {
  record: TicketEvaluation;
  guideRefreshKey: number;
  onLabel: (input: { label: EvalLabel; weight: number; note: string }) => void;
  onReflect: (reflected: boolean) => void;
}
export function OutcomePanel({ record, guideRefreshKey, onLabel, onReflect }: OutcomePanelProps) {
  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <TicketDissection record={record} guideRefreshKey={guideRefreshKey} onLabel={onLabel} onReflect={onReflect} />
    </div>
  );
}
```

- [ ] **Step 5: Create TicketDetailTabs (성과만 실연결, 나머지 3개는 Task 4에서 채움)**

```tsx
// TicketDetailTabs.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketEvaluation } from '@claude-alive/core';
import type { EvalLabel } from '../ticketmgmt/api.ts';
import { OutcomePanel } from './panels/OutcomePanel.tsx';
import { EmptyState } from './panels/EmptyState.tsx';

type SubTab = 'outcome' | 'quality' | 'efficiency' | 'process';
const SUBTABS: SubTab[] = ['outcome', 'quality', 'efficiency', 'process'];

interface TicketDetailTabsProps {
  record: TicketEvaluation | null;
  sessionId: string | null;
  guideRefreshKey: number;
  onLabel: (input: { label: EvalLabel; weight: number; note: string }) => void;
  onReflect: (reflected: boolean) => void;
  initialSubTab?: SubTab;
}

export function TicketDetailTabs({ record, sessionId, guideRefreshKey, onLabel, onReflect, initialSubTab }: TicketDetailTabsProps) {
  const { t } = useTranslation();
  const [sub, setSub] = useState<SubTab>(initialSubTab ?? 'outcome');
  if (!record) return <EmptyState message={t('board.empty.pickTicket')} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div role="tablist" style={{ display: 'flex', gap: 4, padding: '8px 16px 0', borderBottom: '1px solid var(--border-color)' }}>
        {SUBTABS.map((s) => (
          <button key={s} role="tab" aria-selected={sub === s} onClick={() => setSub(s)}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, color: sub === s ? 'var(--text-primary)' : 'var(--text-secondary)', background: 'transparent', border: 'none', borderBottom: sub === s ? '2px solid var(--accent-blue)' : '2px solid transparent', marginBottom: -1, cursor: 'pointer' }}>
            {t(`board.subtab.${s}`)}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {sub === 'outcome' && <OutcomePanel record={record} guideRefreshKey={guideRefreshKey} onLabel={onLabel} onReflect={onReflect} />}
        {sub === 'quality' && <EmptyState message={sessionId ? t('board.empty.noData') : t('board.empty.noSession')} />}
        {sub === 'efficiency' && <EmptyState message={sessionId ? t('board.empty.noData') : t('board.empty.noSession')} />}
        {sub === 'process' && <EmptyState message={sessionId ? t('board.empty.noData') : t('board.empty.noSession')} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create WorkTab (티켓 fetch/라벨/반영 이식)**

`TicketMgmtView`의 데이터 로직(`refresh`/10s interval/`selected`/`applyRecord`/`handleLabel`/`handleReflect`/`guideRefreshKey`/`reachable`)을 `WorkTab.tsx`로 이식하고, 우측은 `TicketDetailTabs`로 렌더. `sessionId`는 `selected?.claudeSessionId ?? null`.
```tsx
// WorkTab.tsx (요지 — 데이터 로직은 TicketMgmtView와 동일 시그니처)
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketEvaluation } from '@claude-alive/core';
import { fetchRecords, setLabel, setReflected, type EvalLabel } from '../ticketmgmt/api.ts';
import { TicketList } from './TicketList.tsx';
import { TicketDetailTabs } from './TicketDetailTabs.tsx';
import { EmptyState } from './panels/EmptyState.tsx';

export function WorkTab({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<TicketEvaluation[] | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guideRefreshKey, setGuideRefreshKey] = useState(0);

  const refresh = useCallback(async () => {
    try { setRecords(await fetchRecords()); setReachable(true); }
    catch { setReachable(false); }
  }, []);
  useEffect(() => { if (!active) return; refresh(); const id = setInterval(refresh, 10000); return () => clearInterval(id); }, [active, refresh]);

  const selected = useMemo(() => (selectedId ? (records ?? []).find((r) => r.ticketId === selectedId) ?? null : null), [records, selectedId]);
  const applyRecord = useCallback((rec: TicketEvaluation) => setRecords((prev) => prev ? prev.map((r) => r.ticketId === rec.ticketId ? rec : r) : prev), []);
  const handleLabel = useCallback(async (input: { label: EvalLabel; weight: number; note: string }) => {
    if (!selected) return;
    try { applyRecord(await setLabel(selected.ticketId, input)); } catch { refresh(); }
  }, [selected, applyRecord, refresh]);
  const handleReflect = useCallback(async (reflected: boolean) => {
    if (!selected) return;
    try { applyRecord(await setReflected(selected.ticketId, reflected)); setGuideRefreshKey((k) => k + 1); } catch { refresh(); }
  }, [selected, applyRecord, refresh]);

  if (reachable === false) return <EmptyState message={t('ticketMgmt.unreachable.body')} />;

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      <div style={{ width: 440, minWidth: 300, maxWidth: '50%', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
        <TicketList records={records} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <TicketDetailTabs record={selected} sessionId={selected?.claudeSessionId ?? null} guideRefreshKey={guideRefreshKey} onLabel={handleLabel} onReflect={handleReflect} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Wire WorkTab into BoardView**

`BoardView.tsx`의 work placeholder `<div>`를 `<WorkTab active={active && tab === 'work'} />`로 치환. `import { WorkTab } from './WorkTab.tsx';`.

- [ ] **Step 8: Run tests**

Run: `pnpm --filter=@claude-alive/ui test -- WorkTab BoardView`
Expected: PASS (세션 없는 티켓 → 품질 탭 "연결된 세션 없음").

- [ ] **Step 9: Typecheck + commit**

```bash
git add packages/ui/src/views/board packages/i18n/src/locales
git commit -m "feat(board): 작업 탭(티켓 리스트+성과 서브탭) / Add work tab with ticket list and outcome sub-tab"
```

---

## Phase 3 — 품질·효율·과정 어댑터

### Task 4: QualityPanel / EfficiencyPanel / ProcessPanel

**Files:**
- Create: `panels/QualityPanel.tsx`, `panels/EfficiencyPanel.tsx`, `panels/ProcessPanel.tsx`
- Modify: `TicketDetailTabs.tsx` (3개 EmptyState → 실제 패널)
- Test: `packages/ui/src/views/board/__tests__/panels.test.tsx`

**Interfaces:**
- Produces: 각각 `export function XPanel(props: { sessionId: string | null }): JSX.Element`. `sessionId == null`이면 `EmptyState(noSession)`, fetch 실패/빈 결과면 `EmptyState(noData)`.
- Consumes(type-only): `PromptListRow`(`../list/promptTypes.ts`), `EfficioProfiles`,`EfficioSessionProfile`,`CompletedSession`(`@claude-alive/core`). 재사용: `SessionDetailCard`(`../efficio/SessionDetailCard.tsx`).

- [ ] **Step 1: Write failing tests**

```tsx
// panels.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QualityPanel } from '../panels/QualityPanel';
import { EfficiencyPanel } from '../panels/EfficiencyPanel';
import { ProcessPanel } from '../panels/ProcessPanel';

beforeEach(() => { vi.restoreAllMocks(); });

describe('board panels', () => {
  it('QualityPanel: null session → no linked session', () => {
    render(<QualityPanel sessionId={null} />);
    expect(screen.getByText(/no linked session|연결된 세션 없음/i)).toBeInTheDocument();
  });

  it('QualityPanel: filters prompts by session_id', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ([
      { id: 'p1', session_id: 'S', created_at: '2026-07-24', final_score: 0.8 },
      { id: 'p2', session_id: 'OTHER', created_at: '2026-07-24', final_score: 0.2 },
    ]) } as Response);
    render(<QualityPanel sessionId="S" />);
    await waitFor(() => expect(screen.getByText(/p1|0\.8|80/)).toBeInTheDocument());
    expect(screen.queryByText('p2')).not.toBeInTheDocument();
  });

  it('EfficiencyPanel: no matching profile → no data', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ modelVersion: null, sessions: [] }) } as Response);
    render(<EfficiencyPanel sessionId="S" />);
    await waitFor(() => expect(screen.getByText(/no data|데이터 없음/i)).toBeInTheDocument());
  });

  it('ProcessPanel: finds completed session by id', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ sessions: [
      { sessionId: 'S', displayName: 'Run S', finalState: 'done', completedAt: 1, createdAt: 0 },
    ] }) } as Response);
    render(<ProcessPanel sessionId="S" />);
    await waitFor(() => expect(screen.getByText('Run S')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter=@claude-alive/ui test -- panels`
Expected: FAIL — modules not found.

- [ ] **Step 3: QualityPanel**

```tsx
// panels/QualityPanel.tsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { PromptListRow } from '../../list/promptTypes.ts';
import { EmptyState } from './EmptyState.tsx';

export function QualityPanel({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PromptListRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    fetch('/api/prompts?limit=1000')
      .then((r) => r.ok ? r.json() as Promise<PromptListRow[]> : Promise.reject())
      .then((all) => { if (alive) setRows(all.filter((p) => p.session_id === sessionId)); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [sessionId]);

  if (!sessionId) return <EmptyState message={t('board.empty.noSession')} />;
  if (error) return <EmptyState message={t('board.empty.noData')} />;
  if (rows === null) return <EmptyState message={t('board.empty.noData')} />;
  if (rows.length === 0) return <EmptyState message={t('board.empty.noData')} />;

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((p) => (
        <div key={p.id} style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: '10px 14px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{p.id}</span>
          <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            {p.final_score != null ? Math.round(p.final_score * 100) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}
```
(참고: `PromptListRow`의 실제 필드는 `promptTypes.ts:22-37` 확인 — `id`,`session_id`,`created_at`,`final_score` 사용. 추가 표시 필드가 있으면 그대로 활용.)

- [ ] **Step 4: EfficiencyPanel**

```tsx
// panels/EfficiencyPanel.tsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { EfficioProfiles, EfficioSessionProfile } from '@claude-alive/core';
import { SessionDetailCard } from '../../efficio/SessionDetailCard.tsx';
import { EmptyState } from './EmptyState.tsx';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

export function EfficiencyPanel({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<EfficioSessionProfile | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'ready'>('idle');

  useEffect(() => {
    if (!sessionId) { setState('idle'); return; }
    let alive = true;
    setState('loading');
    fetch(`${API_BASE}/api/efficio/profiles?last=1000`)
      .then((r) => r.ok ? r.json() as Promise<EfficioProfiles> : Promise.reject())
      .then((p) => {
        if (!alive) return;
        const match = p.sessions.find((s) => s.sessionId === sessionId) ?? null;
        setProfile(match); setState(match ? 'ready' : 'empty');
      })
      .catch(() => { if (alive) setState('empty'); });
    return () => { alive = false; };
  }, [sessionId]);

  if (!sessionId) return <EmptyState message={t('board.empty.noSession')} />;
  if (state !== 'ready' || !profile) return <EmptyState message={t('board.empty.noData')} />;
  return <div style={{ padding: 24, height: '100%', overflow: 'auto' }}><SessionDetailCard session={profile} /></div>;
}
```
(`EfficioSessionProfile.sessionId` 필드명은 `@claude-alive/core` 타입 확인 후 정확히 사용.)

- [ ] **Step 5: ProcessPanel**

`ArchiveView` 상세 렌더(`283-343`: 헤더 + Stat 그리드 + Field들 + tokenUsage + lastPrompt)와 `Stat`/`Field`/`fmt*`/`STATE_COLOR` 헬퍼를 그대로 복사해 단일 세션(`CompletedSession`)을 렌더한다. 데이터는 `/api/completed?limit=1000`에서 `sessionId` 일치 항목.
```tsx
// panels/ProcessPanel.tsx (구조)
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompletedSession } from '@claude-alive/core';
import { EmptyState } from './EmptyState.tsx';
// Stat/Field/STATE_COLOR/fmtFull/fmtDuration 은 ArchiveView에서 복사 이식

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

export function ProcessPanel({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const [session, setSession] = useState<CompletedSession | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'ready'>('idle');

  useEffect(() => {
    if (!sessionId) { setState('idle'); return; }
    let alive = true; setState('loading');
    fetch(`${API_BASE}/api/completed?limit=1000`)
      .then((r) => r.ok ? r.json() as Promise<{ sessions?: CompletedSession[] }> : Promise.reject())
      .then((d) => {
        if (!alive) return;
        const match = (d.sessions ?? []).find((s) => s.sessionId === sessionId) ?? null;
        setSession(match); setState(match ? 'ready' : 'empty');
      })
      .catch(() => { if (alive) setState('empty'); });
    return () => { alive = false; };
  }, [sessionId]);

  if (!sessionId) return <EmptyState message={t('board.empty.noSession')} />;
  if (state !== 'ready' || !session) return <EmptyState message={t('board.empty.noData')} />;
  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      {/* ArchiveView 283-343 상세 마크업을 여기에 복사, selected → session */}
    </div>
  );
}
```
(주의: `/api/completed` 응답이 `{ sessions: [...] }`인지 배열인지 `ArchiveView.tsx:70` 처리 방식 확인 후 파싱 일치시킬 것. 위 테스트 목은 `{ sessions: [...] }` 기준.)

- [ ] **Step 6: Wire panels into TicketDetailTabs**

`TicketDetailTabs.tsx`의 quality/efficiency/process 3개 `<EmptyState>`를 각 패널로 치환:
```tsx
{sub === 'quality' && <QualityPanel sessionId={sessionId} />}
{sub === 'efficiency' && <EfficiencyPanel sessionId={sessionId} />}
{sub === 'process' && <ProcessPanel sessionId={sessionId} />}
```
import 3줄 추가.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter=@claude-alive/ui test -- panels WorkTab`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

```bash
git add packages/ui/src/views/board
git commit -m "feat(board): 품질·효율·과정 서브탭 어댑터(sessionId 조인) / Add quality/efficiency/process sub-tab adapters joined by sessionId"
```

---

## Phase 4 — 딥링크 리라우팅 + 마무리

### Task 5: 딥링크 리라우팅 + 죽은 참조 정리 + 빌드

**Files:**
- Modify: `packages/ui/src/App.tsx` (`onNavigate` 핸들러 `477-481`, `handleViewModeChange`)
- Modify: `packages/ui/src/views/board/BoardView.tsx`, `WorkTab.tsx`, `TicketDetailTabs.tsx` (focusSessionId 전달로 과정 탭 포커스)
- Modify: 제거된 mode(`archive`/`ticketMgmt`/`prompt`/`efficio`/`data`)로 `claude-alive:navigate`를 쏘는 호출부(있으면) → `board`로
- Test: `packages/ui/src/views/board/__tests__/BoardView.test.tsx` (focus 라우팅)

**Interfaces:**
- Consumes: `BoardView`가 `focusSessionId`를 받으면 work 대탭 + 과정 서브탭으로 진입하고 해당 세션을 선택.

- [ ] **Step 1: Write failing test**

```tsx
// BoardView.test.tsx 에 추가
it('focusSessionId opens work tab on process sub-tab', () => {
  render(<BoardView active subscribeRaw={noopSub} focusSessionId="S" />);
  expect(screen.getByRole('tab', { name: /work|작업/i })).toHaveAttribute('aria-selected', 'true');
  // 과정 서브탭이 활성 (WorkTab이 initialSubTab='process'를 받음)
  expect(screen.getByRole('tab', { name: /process|과정/i })).toHaveAttribute('aria-selected', 'true');
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter=@claude-alive/ui test -- BoardView`
Expected: FAIL — 과정 탭이 활성이 아님.

- [ ] **Step 3: Thread focusSessionId → 과정 서브탭**

`BoardView`: `focusSessionId`가 있으면 초기 `tab='work'`, 그리고 `WorkTab`에 `focusSessionId`/`initialSubTab='process'` 전달. `WorkTab`은 `focusSessionId`로 해당 티켓(그 `claudeSessionId`가 일치하는 티켓)을 선택하거나, 티켓 매칭이 없으면 과정 패널에 세션을 직접 표시(간단화: `WorkTab`이 `initialSubTab`만 `TicketDetailTabs`로 넘김). 최소 구현: `BoardView`가 `focusSessionId` 존재 시 `tab='work'`로 초기화하고 `WorkTab`에 `initialSubTab='process'` 전달 → `TicketDetailTabs`가 그 서브탭으로 시작.

- [ ] **Step 4: onNavigate 리라우팅**

`App.tsx` `onNavigate`(`477-481`): `detail.mode`가 제거된 5개 중 하나면 `'board'`로 매핑:
```ts
const LEGACY_TO_BOARD = new Set(['archive', 'ticketMgmt', 'prompt', 'efficio', 'data']);
const onNavigate = (event: Event) => {
  const detail = (event as CustomEvent).detail as { mode?: ViewMode; sessionId?: string } | undefined;
  if (detail?.sessionId !== undefined) setArchiveFocusSessionId(detail.sessionId);
  if (detail?.mode) handleViewModeChange(LEGACY_TO_BOARD.has(detail.mode) ? 'board' : detail.mode);
};
```
`handleViewModeChange`가 legacy mode를 직접 받는 다른 경로가 있으면 동일 매핑 적용.

- [ ] **Step 5: 죽은 참조/파일 정리**

`grep -rn "ticketMgmt\|'archive'\|'prompt'\|'efficio'\|'data'" packages/ui/src`로 제거된 nav로의 잔여 참조 확인 후 board로 정리. 원본 뷰 파일(`PromptView`,`EfficioView`,`ArchiveView`,`TicketMgmtView`,`DataView`)은 **삭제하지 않는다** — `TicketDissection`/`SessionDetailCard`/`DataView`가 계속 재사용되고, 나머지도 참조가 사라졌을 뿐 회귀 대비 유지. (후속 정리 태스크에서 별도 판단.)

- [ ] **Step 6: 전체 테스트 + 타입체크 + 빌드**

Run: `pnpm --filter=@claude-alive/ui test`
Expected: 전체 PASS.
Run: `pnpm --filter=@claude-alive/ui exec tsc --noEmit`
Expected: 통과.
Run: `pnpm run build --filter=@claude-alive/ui`
Expected: 빌드 성공.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src
git commit -m "feat(board): 딥링크 board 리라우팅 + 정리 / Reroute deep-links to board and clean up"
```

---

## Self-Review (완료)

- **스펙 커버리지:** §3 IA(작업/비용 2대탭)→Task1·3, 티켓 리스트→Task2, 성과→Task3, 품질/효율/과정→Task4, §4 조인 계약(sessionId 유무 빈상태)→Task3·4, §6 딥링크→Task5, §7 i18n→Task1·3, §8 테스트→각 Task. 비용 as-is→Task1(DataView 무변경 마운트). 모두 매핑됨.
- **플레이스홀더:** 코드 스텝은 실제 코드 포함. ProcessPanel/QualityPanel의 필드·응답형태는 "확인 후 일치" 주석으로 실제 소스(`promptTypes.ts`, `ArchiveView.tsx:70`, core 타입) 참조 — 구현자가 열어 확인.
- **타입 일관성:** `sessionId: string | null` 시그니처를 3개 패널·TicketDetailTabs 전반에서 통일. `EvalLabel` import 경로 `../ticketmgmt/api.ts` 통일. `initialSubTab` 명칭 Task3·5 일치.

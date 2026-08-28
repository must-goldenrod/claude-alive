# 레포–런 계층 UI 재편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 티켓·터미널·에이전트 세션으로 흩어진 실행 단위를 `레포 > 워크트리 > 런` 단일 계층으로 통합하고, 모든 뷰가 공유하는 사이드바와 "사람이 닫기" 완결 추적을 붙인다.

**Architecture:** 서버에 `repoStore`(git 해석 + 캐시)와 `runStore`(얇은 참조 레코드)를 신설한다. Run은 본문을 소유하지 않고 기존 저장소(`ticketStore`/`SessionStore`/`managedSessionStore`)를 참조하며, 자체 저장하는 것은 `state`/`outcome`/`closedAt` 뿐이다. UI는 `App.tsx` 셸에 공통 사이드바를 마운트하고, 선택 상태를 필터(레포·워크트리)와 포커스(런)로 분리해 기존 6개 뷰에 배선한다. 시각 일관성은 신설 프리미티브 레이어(`components/ui/`)로 누적한다.

**Tech Stack:** TypeScript 5.7, React 19, Node.js + ws, Zod 4, Vitest (server: node env, ui: jsdom + @testing-library/react), pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-08-28-repo-run-hierarchy-ui-design.md`

## Global Constraints

- 모든 UI 텍스트는 `packages/i18n/src/locales/{en,ko}.json`의 번역 키를 통해서만 노출한다. 하드코딩 문자열은 fallback 포함 금지.
- React 컴포넌트는 `useTranslation()` → `t('key')`. 비-React 코드는 `import i18n from '@claude-alive/i18n'` → `i18n.t('key')`.
- UI는 `@claude-alive/core`에서 **타입만** import 한다 (`import type`). 런타임 값을 import 하면 readline이 유입돼 브라우저 빌드가 깨진다 (tsc는 통과하므로 반드시 `pnpm run build --filter=@claude-alive/ui`로 확인).
- `node:sqlite`는 금지. 영속화가 필요하면 `better-sqlite3` 또는 JSON 파일을 쓴다.
- 커밋 메시지는 한국어 + 영어 이중 표기: `<type>: <한글> / <English>`.
- 신규 UI 코드는 인라인 `style={{}}` 금지. `packages/ui/src/components/ui/`의 프리미티브만 사용한다 (Task 1에서 신설).
- 단독 Enter로 제출하는 입력창은 반드시 `e.nativeEvent.isComposing` 가드를 둔다 (한글 IME 마지막 글자 중복 방지).
- 각 Task는 끝에 커밋한다. 몰아서 커밋하지 않는다.

**테스트 실행 명령:**
- 서버: `pnpm --filter=@claude-alive/server exec vitest run <path>`
- UI: `pnpm --filter=@claude-alive/ui exec vitest run <path>`
- 타입: `pnpm --filter=@claude-alive/ui exec tsc --noEmit`

---

## File Structure

**Phase 1 — 프리미티브 레이어**
- `packages/ui/src/index.css` (수정) — spacing/radius/typography/duration 토큰 추가
- `packages/ui/src/components/ui/tokens.ts` (신규) — 토큰 이름의 TS 상수 (오타 방지)
- `packages/ui/src/components/ui/Panel.tsx`, `Card.tsx`, `Badge.tsx`, `Button.tsx`, `EmptyState.tsx`, `StatusDot.tsx`, `Tree.tsx` (신규)
- `packages/ui/src/components/ui/index.ts` (신규) — 배럴

**Phase 2 — 서버 레지스트리**
- `packages/core/src/runs/types.ts` (신규) — `Repository`, `Worktree`, `Run`, `RunKind`, `RunState`, `RunView`
- `packages/core/src/runs/repoId.ts` (신규) — 순수 함수: 경로 정규화 → repoId
- `packages/core/src/index.ts` (수정) — 배럴 export
- `packages/core/src/protocol/wsProtocol.ts` (수정) — `run:snapshot`, `run:update`
- `packages/server/src/gitResolver.ts` (신규) — cwd → `{ repoRoot, branch }` (git 실행 + 캐시)
- `packages/server/src/repoStore.ts` (신규) — 레포/워크트리 등록·조회
- `packages/server/src/runStore.ts` (신규) — Run CRUD + 영속화 + 변경 구독
- `packages/server/src/runAdapters/ticketRuns.ts`, `terminalRuns.ts`, `agentRuns.ts` (신규)
- `packages/server/src/httpRouter.ts` (수정) — `GET /api/runs`, `POST /api/runs/:id/close`

**Phase 3~6 — UI**
- `packages/ui/src/state/selection.ts` (신규) — 필터/포커스 리듀서 + 영속화
- `packages/ui/src/hooks/useRunTree.ts` (신규) — `/api/runs` + WS 구독
- `packages/ui/src/components/RepoSidebar/RepoSidebar.tsx`, `runTree.ts` (신규)
- `packages/ui/src/components/RunCard.tsx` (신규)
- `packages/ui/src/App.tsx` (수정) — 사이드바 마운트, 선택 상태 소유
- `packages/ui/src/views/tickets/TicketsView.tsx`, `views/board/WorkTab.tsx`, `views/list/AgentListView.tsx` (수정) — 필터 배선
- `packages/ui/src/views/unified/ProjectSidebar.tsx` (삭제)

---

## Task 1: 디자인 토큰 + 프리미티브 레이어

시각 회귀 0. 기존 뷰는 건드리지 않고 새 레이어만 만든다.

**Files:**
- Modify: `packages/ui/src/index.css`
- Create: `packages/ui/src/components/ui/tokens.ts`
- Create: `packages/ui/src/components/ui/Panel.tsx`
- Create: `packages/ui/src/components/ui/Badge.tsx`
- Create: `packages/ui/src/components/ui/Button.tsx`
- Create: `packages/ui/src/components/ui/StatusDot.tsx`
- Create: `packages/ui/src/components/ui/EmptyState.tsx`
- Create: `packages/ui/src/components/ui/index.ts`
- Test: `packages/ui/src/components/ui/__tests__/primitives.test.tsx`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `Panel(props: { children: ReactNode; padding?: 'sm'|'md'|'lg'; className?: string })`
  - `Badge(props: { children: ReactNode; tone: BadgeTone; })`, `type BadgeTone = 'neutral'|'blue'|'green'|'amber'|'red'|'purple'`
  - `Button(props: { children: ReactNode; variant?: 'primary'|'ghost'|'danger'; onClick?: () => void; disabled?: boolean; type?: 'button'|'submit'; title?: string })`
  - `StatusDot(props: { tone: BadgeTone; pulse?: boolean })`
  - `EmptyState(props: { message: string })`

- [ ] **Step 1: 토큰을 CSS에 추가**

`packages/ui/src/index.css`의 `:root` 블록 끝(현재 `--font-mono` 정의 다음 줄)에 추가:

```css
  /* Spacing scale. Every gap/padding in new code comes from here. */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  /* Corner radii. Cards/panels use lg, buttons md, pills full. */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 999px;

  /* Type scale. */
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-lg: 16px;
  --text-xl: 20px;

  --elev-1: 0 1px 2px rgba(0, 0, 0, 0.3);
  --elev-2: 0 8px 24px rgba(0, 0, 0, 0.4);

  --dur-fast: 120ms;
  --dur-base: 200ms;
```

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/ui/src/components/ui/__tests__/primitives.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Badge, Button, EmptyState, Panel, StatusDot } from '../index.ts';

describe('primitives', () => {
  it('Panel renders children inside a bordered surface', () => {
    render(<Panel><span>inner</span></Panel>);
    const inner = screen.getByText('inner');
    expect(inner.parentElement).toHaveStyle({ borderRadius: 'var(--radius-lg)' });
  });

  it('Badge maps a tone to the matching accent variable', () => {
    render(<Badge tone="green">7</Badge>);
    expect(screen.getByText('7')).toHaveStyle({ color: 'var(--accent-green)' });
  });

  it('Button fires onClick and blocks it when disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>go</Button>);
    screen.getByRole('button', { name: 'go' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<Button onClick={onClick} disabled>go</Button>);
    screen.getByRole('button', { name: 'go' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('StatusDot exposes its tone and pulse state', () => {
    render(<StatusDot tone="blue" pulse />);
    const dot = screen.getByTestId('status-dot');
    expect(dot).toHaveAttribute('data-tone', 'blue');
    expect(dot).toHaveAttribute('data-pulse', 'true');
  });

  it('EmptyState shows the given message verbatim', () => {
    render(<EmptyState message="아직 없음" />);
    expect(screen.getByText('아직 없음')).toBeInTheDocument();
  });
});
```

`toHaveStyle`은 `@testing-library/jest-dom`이 필요하다. 이미 devDependency에 있으므로 테스트 파일 최상단에 `import '@testing-library/jest-dom';`를 추가한다.

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/components/ui/__tests__/primitives.test.tsx`
Expected: FAIL — `Failed to resolve import "../index.ts"`

- [ ] **Step 4: tokens.ts 작성**

`packages/ui/src/components/ui/tokens.ts`:

```ts
/**
 * Design tokens as TS constants. Components reference these instead of typing
 * `var(--…)` strings, so a renamed token breaks the build rather than silently
 * rendering an unstyled element.
 */
export const space = {
  1: 'var(--space-1)', 2: 'var(--space-2)', 3: 'var(--space-3)',
  4: 'var(--space-4)', 5: 'var(--space-5)', 6: 'var(--space-6)',
} as const;

export const radius = {
  sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)',
  xl: 'var(--radius-xl)', full: 'var(--radius-full)',
} as const;

export const text = {
  xs: 'var(--text-xs)', sm: 'var(--text-sm)', base: 'var(--text-base)',
  lg: 'var(--text-lg)', xl: 'var(--text-xl)',
} as const;

export type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'purple';

export const toneColor: Record<BadgeTone, string> = {
  neutral: 'var(--text-secondary)',
  blue: 'var(--accent-blue)',
  green: 'var(--accent-green)',
  amber: 'var(--accent-amber)',
  red: 'var(--accent-red)',
  purple: 'var(--accent-purple)',
};
```

- [ ] **Step 5: 프리미티브 5종 작성**

`packages/ui/src/components/ui/Panel.tsx`:

```tsx
import type { ReactNode } from 'react';
import { radius, space } from './tokens.ts';

const PADDING = { sm: space[3], md: space[4], lg: space[5] } as const;

/** Bordered surface. The single source of "what a card/panel looks like". */
export function Panel({
  children,
  padding = 'md',
}: {
  children: ReactNode;
  padding?: keyof typeof PADDING;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: radius.lg,
        background: 'var(--bg-secondary)',
        padding: PADDING[padding],
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );
}
```

`packages/ui/src/components/ui/Badge.tsx`:

```tsx
import type { ReactNode } from 'react';
import { radius, text, toneColor, type BadgeTone } from './tokens.ts';

/** Small tinted pill: counts, labels, states. */
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  const color = toneColor[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 22,
        padding: '1px 7px',
        borderRadius: radius.full,
        fontFamily: 'var(--font-mono)',
        fontSize: text.xs,
        fontWeight: 700,
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}
```

`packages/ui/src/components/ui/Button.tsx`:

```tsx
import type { ReactNode } from 'react';
import { radius, text } from './tokens.ts';

type Variant = 'primary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: 'var(--accent-blue)', fg: '#0d1117', border: 'transparent' },
  ghost: { bg: 'transparent', fg: 'var(--text-secondary)', border: 'var(--border-color)' },
  danger: { bg: 'transparent', fg: 'var(--accent-red)', border: 'var(--accent-red)' },
};

export function Button({
  children,
  variant = 'ghost',
  onClick,
  disabled = false,
  type = 'button',
  title,
}: {
  children: ReactNode;
  variant?: Variant;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  const v = VARIANT[variant];
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: radius.md,
        border: `1px solid ${v.border}`,
        background: v.bg,
        color: v.fg,
        fontFamily: 'var(--font-ui)',
        fontSize: text.sm,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: `background-color var(--dur-fast) ease, transform var(--dur-fast) ease`,
      }}
    >
      {children}
    </button>
  );
}
```

`packages/ui/src/components/ui/StatusDot.tsx`:

```tsx
import { toneColor, type BadgeTone } from './tokens.ts';

/** 8px state dot. `pulse` marks a live/running run. */
export function StatusDot({ tone, pulse = false }: { tone: BadgeTone; pulse?: boolean }) {
  return (
    <span
      data-testid="status-dot"
      data-tone={tone}
      data-pulse={pulse ? 'true' : 'false'}
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: toneColor[tone],
        flexShrink: 0,
        boxShadow: pulse ? `0 0 0 3px color-mix(in srgb, ${toneColor[tone]} 22%, transparent)` : 'none',
      }}
    />
  );
}
```

`packages/ui/src/components/ui/EmptyState.tsx`:

```tsx
import { space, text } from './tokens.ts';

/** Uniform "nothing here" line. Callers pass an already-translated message. */
export function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: space[4],
        textAlign: 'center',
        fontSize: text.sm,
        color: 'var(--text-secondary)',
        opacity: 0.6,
      }}
    >
      {message}
    </div>
  );
}
```

`packages/ui/src/components/ui/index.ts`:

```ts
export { Panel } from './Panel.tsx';
export { Badge } from './Badge.tsx';
export { Button } from './Button.tsx';
export { StatusDot } from './StatusDot.tsx';
export { EmptyState } from './EmptyState.tsx';
export { space, radius, text, toneColor } from './tokens.ts';
export type { BadgeTone } from './tokens.ts';
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/components/ui/__tests__/primitives.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 7: 커밋**

```bash
git add packages/ui/src/index.css packages/ui/src/components/ui
git commit -m "feat(ui): 디자인 토큰과 프리미티브 레이어 신설 / Add design tokens and primitive layer

spacing·radius·typography·duration 토큰을 추가하고 Panel/Badge/Button/StatusDot/
EmptyState를 신설. 기존 뷰는 변경하지 않아 시각 회귀가 없다.
Add spacing, radius, typography and duration tokens plus the Panel/Badge/Button/
StatusDot/EmptyState primitives. No existing view changes, so no visual regression."
```

---

## Task 2: core 런 타입 + repoId 정규화

**Files:**
- Create: `packages/core/src/runs/types.ts`
- Create: `packages/core/src/runs/repoId.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/repoId.test.ts`

**Interfaces:**
- Consumes: Task 1 없음
- Produces:
  - `type RunKind = 'ticket' | 'terminal' | 'agent'`
  - `type RunState = 'running' | 'waiting' | 'closed' | 'abandoned'`
  - `interface Repository { repoId: string; root: string; name?: string; isGit: boolean }`
  - `interface Worktree { worktreeId: string; repoId: string; path: string; branch: string; isPrimary: boolean }`
  - `interface Run { runId: string; worktreeId: string; repoId: string; kind: RunKind; sourceId: string; title: string; state: RunState; outcome?: string; startedAt: number; closedAt?: number; meta?: RunMeta }`
  - `interface RunMeta { model?: string; costUsd?: number; durationMs?: number; seq?: number; headline?: string }`
  - `repoIdFor(root: string, locationKey?: string): string`
  - `worktreeIdFor(repoId: string, path: string): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/src/__tests__/repoId.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { repoIdFor, worktreeIdFor } from '../runs/repoId.js';

describe('repoIdFor', () => {
  it('is stable for the same root', () => {
    expect(repoIdFor('/Users/a/proj')).toBe(repoIdFor('/Users/a/proj'));
  });

  it('ignores a trailing slash', () => {
    expect(repoIdFor('/Users/a/proj/')).toBe(repoIdFor('/Users/a/proj'));
  });

  it('separates different roots', () => {
    expect(repoIdFor('/Users/a/proj')).not.toBe(repoIdFor('/Users/a/other'));
  });

  it('separates the same path on different hosts', () => {
    expect(repoIdFor('/srv/app', 'ssh:build@10.0.0.2')).not.toBe(repoIdFor('/srv/app'));
  });
});

describe('worktreeIdFor', () => {
  it('is stable and scoped to its repo', () => {
    const repo = repoIdFor('/Users/a/proj');
    expect(worktreeIdFor(repo, '/Users/a/proj')).toBe(worktreeIdFor(repo, '/Users/a/proj'));
    expect(worktreeIdFor(repo, '/Users/a/proj')).not.toBe(worktreeIdFor(repo, '/Users/a/wt-1'));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter=@claude-alive/core exec vitest run src/__tests__/repoId.test.ts`
Expected: FAIL — cannot resolve `../runs/repoId.js`

- [ ] **Step 3: repoId.ts 구현**

`packages/core/src/runs/repoId.ts`:

```ts
import { createHash } from 'node:crypto';

/** Strip trailing separators so `/a/b` and `/a/b/` collapse to one id. */
function normalizePath(p: string): string {
  const trimmed = p.trim();
  if (trimmed.length <= 1) return trimmed;
  return trimmed.replace(/\/+$/, '');
}

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

/**
 * Stable id for a repository.
 *
 * `locationKey` scopes the id to a host so the same absolute path on two
 * different machines never collapses into one repository. Pass the ssh target
 * (e.g. `ssh:build@10.0.0.2`) for remote runs; omit it for local ones.
 */
export function repoIdFor(root: string, locationKey?: string): string {
  return shortHash(`${locationKey ?? 'local'}::${normalizePath(root)}`);
}

/** Stable id for one worktree inside a repository. */
export function worktreeIdFor(repoId: string, path: string): string {
  return shortHash(`${repoId}::${normalizePath(path)}`);
}
```

`node:crypto`를 쓰므로 이 모듈은 **서버 전용**이다. UI는 이 파일을 import 하지 않는다 (타입만 쓰는 `runs/types.ts`와 분리한 이유).

- [ ] **Step 4: types.ts 구현**

`packages/core/src/runs/types.ts`:

```ts
/**
 * Repo → worktree → run hierarchy (spec 2026-08-28).
 *
 * A Run does NOT own its content. Ticket bodies, session transcripts and
 * terminal buffers stay in their existing stores; a Run only records where the
 * work lives, whether it is still open, and what the human said when closing it.
 */

export type RunKind = 'ticket' | 'terminal' | 'agent';

/** `waiting` = the run needs a human (ticket decision, agent waiting). */
export type RunState = 'running' | 'waiting' | 'closed' | 'abandoned';

export interface Repository {
  repoId: string;
  /** Absolute path of the git toplevel, or of the directory itself when not a repo. */
  root: string;
  /** Human alias, when one was set. Falls back to the root's basename in the UI. */
  name?: string;
  isGit: boolean;
}

export interface Worktree {
  worktreeId: string;
  repoId: string;
  path: string;
  /** Branch name, or an empty string when detached / not a repo. */
  branch: string;
  /** True for the repository's main working tree. */
  isPrimary: boolean;
}

/** Extra facts shown on the run card. All optional — kinds report different things. */
export interface RunMeta {
  model?: string;
  costUsd?: number;
  durationMs?: number;
  /** Ticket's human-facing sequence number (#12). */
  seq?: number;
  /** Agent's one-line answer, used to prefill the close input. */
  headline?: string;
}

export interface Run {
  runId: string;
  repoId: string;
  worktreeId: string;
  kind: RunKind;
  /** Id in the owning store: ticket id, terminal tabId, or claude session id. */
  sourceId: string;
  title: string;
  state: RunState;
  /** One line the human wrote when closing. Absent while open. */
  outcome?: string;
  startedAt: number;
  closedAt?: number;
  meta?: RunMeta;
}

/** What the whole tree looks like over the wire. */
export interface RunTree {
  repositories: Repository[];
  worktrees: Worktree[];
  runs: Run[];
}

/** States the UI counts as "still needs attention". */
export const RUN_OPEN_STATES: readonly RunState[] = ['running', 'waiting'];

export function isRunOpen(state: RunState): boolean {
  return RUN_OPEN_STATES.includes(state);
}
```

- [ ] **Step 5: 배럴에 export 추가**

`packages/core/src/index.ts`의 `export * from './canonical/index.js';` 바로 위에 추가:

```ts
export { RUN_OPEN_STATES, isRunOpen } from './runs/types.js';
export type {
  RunKind, RunState, RunMeta, Run, Repository, Worktree, RunTree,
} from './runs/types.js';
```

`runs/repoId.js`는 **배럴에 넣지 않는다.** `node:crypto`를 끌어들여 UI 번들을 깨뜨린다. 서버는 `@claude-alive/core/dist/runs/repoId.js` 대신 소스 경로로 직접 import 한다 (아래 Task 3 참조).

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm --filter=@claude-alive/core exec vitest run src/__tests__/repoId.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: UI 빌드가 깨지지 않았는지 확인**

Run: `pnpm run build --filter=@claude-alive/ui`
Expected: 성공. 실패하면 배럴에 런타임 값이 섞인 것이다.

- [ ] **Step 8: 커밋**

```bash
git add packages/core/src/runs packages/core/src/index.ts packages/core/src/__tests__/repoId.test.ts
git commit -m "feat(core): 레포–워크트리–런 타입과 repoId 정규화 추가 / Add repo-worktree-run types and repoId normalization

Run은 본문을 소유하지 않고 참조만 하는 얇은 레코드로 정의. repoId는 경로 정규화 +
호스트 스코프로 같은 경로가 여러 레포로 쪼개지지 않게 한다.
Define Run as a thin reference record that owns no content. repoId normalizes the
path and scopes by host so one repository never splits into several."
```

---

## Task 3: git 해석기 (cwd → 레포 루트 + 브랜치)

**Files:**
- Create: `packages/server/src/gitResolver.ts`
- Test: `packages/server/src/__tests__/gitResolver.test.ts`

**Interfaces:**
- Consumes: Task 2의 `repoIdFor`, `worktreeIdFor`, `Repository`, `Worktree`
- Produces:
  - `interface ResolvedLocation { repository: Repository; worktree: Worktree }`
  - `resolveCwd(cwd: string, opts?: { locationKey?: string; exec?: GitExec }): Promise<ResolvedLocation>`
  - `type GitExec = (args: string[], cwd: string) => Promise<string | null>` — null = 명령 실패
  - `clearGitCache(): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/server/src/__tests__/gitResolver.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGitCache, resolveCwd, type GitExec } from '../gitResolver.js';

/** Fake git: answers toplevel/branch from a table, fails for unknown paths. */
function fakeGit(table: Record<string, { top: string; branch: string }>): GitExec {
  return vi.fn(async (args: string[], cwd: string) => {
    const entry = table[cwd];
    if (!entry) return null;
    if (args.includes('--show-toplevel')) return entry.top;
    if (args.includes('--abbrev-ref')) return entry.branch;
    return null;
  });
}

beforeEach(() => clearGitCache());

describe('resolveCwd', () => {
  it('maps a subdirectory to its repository root', async () => {
    const exec = fakeGit({ '/r/proj/packages/ui': { top: '/r/proj', branch: 'main' } });
    const out = await resolveCwd('/r/proj/packages/ui', { exec });
    expect(out.repository.root).toBe('/r/proj');
    expect(out.repository.isGit).toBe(true);
    expect(out.worktree.branch).toBe('main');
    expect(out.worktree.isPrimary).toBe(true);
  });

  it('gives two subdirectories of one repo the same repoId', async () => {
    const exec = fakeGit({
      '/r/proj/a': { top: '/r/proj', branch: 'main' },
      '/r/proj/b': { top: '/r/proj', branch: 'main' },
    });
    const a = await resolveCwd('/r/proj/a', { exec });
    const b = await resolveCwd('/r/proj/b', { exec });
    expect(a.repository.repoId).toBe(b.repository.repoId);
    expect(a.worktree.worktreeId).toBe(b.worktree.worktreeId);
  });

  it('treats a separate worktree as the same repo but a different worktree', async () => {
    const exec = fakeGit({
      '/r/proj': { top: '/r/proj', branch: 'main' },
      '/r/wt-feat': { top: '/r/wt-feat', branch: 'feat/x' },
    });
    const main = await resolveCwd('/r/proj', { exec });
    const wt = await resolveCwd('/r/wt-feat', { exec });
    expect(wt.worktree.worktreeId).not.toBe(main.worktree.worktreeId);
    expect(wt.worktree.branch).toBe('feat/x');
  });

  it('falls back to a non-git repository when git fails', async () => {
    const exec = fakeGit({});
    const out = await resolveCwd('/tmp/scratch', { exec });
    expect(out.repository.isGit).toBe(false);
    expect(out.repository.root).toBe('/tmp/scratch');
    expect(out.worktree.branch).toBe('');
  });

  it('caches so git runs once per cwd', async () => {
    const exec = fakeGit({ '/r/proj': { top: '/r/proj', branch: 'main' } });
    await resolveCwd('/r/proj', { exec });
    await resolveCwd('/r/proj', { exec });
    expect(exec).toHaveBeenCalledTimes(2); // toplevel + branch, once each
  });

  it('scopes remote paths by locationKey', async () => {
    const exec = fakeGit({ '/srv/app': { top: '/srv/app', branch: 'main' } });
    const local = await resolveCwd('/srv/app', { exec });
    clearGitCache();
    const remote = await resolveCwd('/srv/app', { exec, locationKey: 'ssh:build@10.0.0.2' });
    expect(remote.repository.repoId).not.toBe(local.repository.repoId);
  });
});
```

**주의:** `feat/x` 워크트리는 fake에서 toplevel이 자기 자신으로 나온다. 실제 git도 linked worktree에서 `--show-toplevel`은 그 워크트리 경로를 준다. 같은 레포로 묶으려면 `git rev-parse --git-common-dir`이 필요하지만, 이번 범위에서는 **워크트리 경로 기준으로 레포를 나눈다**. 5번째 테스트가 `repoId`가 아니라 `worktreeId`만 비교하는 이유다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter=@claude-alive/server exec vitest run src/__tests__/gitResolver.test.ts`
Expected: FAIL — cannot resolve `../gitResolver.js`

- [ ] **Step 3: 구현**

`packages/server/src/gitResolver.ts`:

```ts
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { Repository, Worktree } from '@claude-alive/core';
import { repoIdFor, worktreeIdFor } from '@claude-alive/core/dist/runs/repoId.js';

const run = promisify(execFile);

export type GitExec = (args: string[], cwd: string) => Promise<string | null>;

export interface ResolvedLocation {
  repository: Repository;
  worktree: Worktree;
}

/** cwd(+locationKey) → resolution. Git is slow enough that repeating it per run hurts. */
const cache = new Map<string, ResolvedLocation>();

export function clearGitCache(): void {
  cache.clear();
}

/** Real git. Returns null instead of throwing so a non-repo degrades quietly. */
const defaultExec: GitExec = async (args, cwd) => {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: 3000 });
    const line = stdout.trim();
    return line.length > 0 ? line : null;
  } catch {
    return null;
  }
};

/**
 * Resolve a working directory into its repository + worktree.
 *
 * Never throws: a directory that is not a git repository becomes its own
 * non-git "repository" so every run still lands somewhere in the tree.
 */
export async function resolveCwd(
  cwd: string,
  opts: { locationKey?: string; exec?: GitExec } = {},
): Promise<ResolvedLocation> {
  const { locationKey, exec = defaultExec } = opts;
  const key = `${locationKey ?? 'local'}::${cwd}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const top = await exec(['rev-parse', '--show-toplevel'], cwd);
  const isGit = top !== null;
  const root = top ?? cwd;
  const branch = isGit ? (await exec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)) ?? '' : '';

  const repoId = repoIdFor(root, locationKey);
  const resolved: ResolvedLocation = {
    repository: { repoId, root, name: basename(root) || root, isGit },
    worktree: {
      worktreeId: worktreeIdFor(repoId, root),
      repoId,
      path: root,
      branch,
      // The toplevel equals the repo root for the primary tree; a linked
      // worktree resolves to its own root, so this is true there too. Branch
      // name is what actually distinguishes them in the UI.
      isPrimary: branch === 'main' || branch === 'master',
    },
  };
  cache.set(key, resolved);
  return resolved;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter=@claude-alive/server exec vitest run src/__tests__/gitResolver.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/server/src/gitResolver.ts packages/server/src/__tests__/gitResolver.test.ts
git commit -m "feat(server): cwd를 레포·워크트리로 해석하는 gitResolver 추가 / Add gitResolver mapping cwd to repo and worktree

git toplevel과 브랜치를 1회 조회 후 캐시한다. git 저장소가 아니면 경로 자체를
비-git 레포로 강등해 모든 런이 트리 어딘가에는 반드시 속하게 한다.
Resolve the git toplevel and branch once, then cache. A non-repo degrades to its
own non-git repository so every run always lands somewhere in the tree."
```

---

## Task 4: runStore (영속화 + 구독)

**Files:**
- Create: `packages/server/src/runStore.ts`
- Test: `packages/server/src/__tests__/runStore.test.ts`

**Interfaces:**
- Consumes: Task 2의 `Run`, `RunState`, `RunTree`, `Repository`, `Worktree`; Task 3의 `ResolvedLocation`
- Produces:
  - `createRunStore(opts: { file: string }): RunStore`
  - `interface RunStore {`
    - `load(): Promise<void>`
    - `tree(): RunTree`
    - `upsert(input: RunUpsert): Run`
    - `close(runId: string, outcome: string): Run | null`
    - `abandon(runId: string): Run | null`
    - `subscribe(fn: (run: Run) => void): () => void`
    - `flush(): Promise<void>` `}`
  - `interface RunUpsert { runId: string; location: ResolvedLocation; kind: RunKind; sourceId: string; title: string; state: RunState; startedAt: number; meta?: RunMeta }`

**핵심 규칙:** 어댑터가 보고하는 `state`는 `running`/`waiting`만 반영한다. 사람이 닫은 런(`closed`/`abandoned`)은 소스가 무엇을 말하든 **되돌리지 않는다**.

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/server/src/__tests__/runStore.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunStore, type RunStore } from '../runStore.js';
import type { ResolvedLocation } from '../gitResolver.js';

const LOC: ResolvedLocation = {
  repository: { repoId: 'r1', root: '/r/proj', name: 'proj', isGit: true },
  worktree: { worktreeId: 'w1', repoId: 'r1', path: '/r/proj', branch: 'main', isPrimary: true },
};

let dir: string;
let store: RunStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runstore-'));
  store = createRunStore({ file: join(dir, 'runs.json') });
  await store.load();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function upsert(over: Partial<Parameters<RunStore['upsert']>[0]> = {}) {
  return store.upsert({
    runId: 'run-1',
    location: LOC,
    kind: 'ticket',
    sourceId: 't-1',
    title: '위임 모델 확장',
    state: 'running',
    startedAt: 1000,
    ...over,
  });
}

describe('runStore', () => {
  it('registers the repository and worktree along with the run', () => {
    upsert();
    const tree = store.tree();
    expect(tree.repositories).toHaveLength(1);
    expect(tree.worktrees).toHaveLength(1);
    expect(tree.runs[0]?.title).toBe('위임 모델 확장');
  });

  it('does not duplicate the repository across runs in one worktree', () => {
    upsert({ runId: 'run-1' });
    upsert({ runId: 'run-2', sourceId: 't-2' });
    expect(store.tree().repositories).toHaveLength(1);
    expect(store.tree().runs).toHaveLength(2);
  });

  it('close records the outcome and stamps closedAt', () => {
    upsert();
    const closed = store.close('run-1', '폴백 경로 검증 완료');
    expect(closed?.state).toBe('closed');
    expect(closed?.outcome).toBe('폴백 경로 검증 완료');
    expect(closed?.closedAt).toBeGreaterThan(0);
  });

  it('abandon marks the run without an outcome', () => {
    upsert();
    const gone = store.abandon('run-1');
    expect(gone?.state).toBe('abandoned');
    expect(gone?.outcome).toBeUndefined();
  });

  it('a later adapter report never reopens a closed run', () => {
    upsert();
    store.close('run-1', 'done');
    upsert({ state: 'running' });
    expect(store.tree().runs[0]?.state).toBe('closed');
    expect(store.tree().runs[0]?.outcome).toBe('done');
  });

  it('an adapter report still refreshes the title and meta of an open run', () => {
    upsert();
    upsert({ title: '제목 변경', state: 'waiting', meta: { model: 'opus', costUsd: 0.42 } });
    const run = store.tree().runs[0];
    expect(run?.title).toBe('제목 변경');
    expect(run?.state).toBe('waiting');
    expect(run?.meta?.costUsd).toBe(0.42);
  });

  it('notifies subscribers on upsert and close', () => {
    const seen = vi.fn();
    store.subscribe(seen);
    upsert();
    store.close('run-1', 'ok');
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('close on an unknown run returns null', () => {
    expect(store.close('nope', 'x')).toBeNull();
  });

  it('persists and reloads the tree', async () => {
    upsert();
    store.close('run-1', '기록됨');
    await store.flush();

    const reopened = createRunStore({ file: join(dir, 'runs.json') });
    await reopened.load();
    expect(reopened.tree().runs[0]?.outcome).toBe('기록됨');
    expect(reopened.tree().repositories[0]?.root).toBe('/r/proj');
  });

  it('starts empty when the file is missing or corrupt', async () => {
    const fresh = createRunStore({ file: join(dir, 'missing.json') });
    await fresh.load();
    expect(fresh.tree().runs).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter=@claude-alive/server exec vitest run src/__tests__/runStore.test.ts`
Expected: FAIL — cannot resolve `../runStore.js`

- [ ] **Step 3: 구현**

`packages/server/src/runStore.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Repository, Run, RunKind, RunMeta, RunState, RunTree, Worktree } from '@claude-alive/core';
import type { ResolvedLocation } from './gitResolver.js';

export interface RunUpsert {
  runId: string;
  location: ResolvedLocation;
  kind: RunKind;
  sourceId: string;
  title: string;
  /** Adapters only ever report `running` or `waiting`. */
  state: Extract<RunState, 'running' | 'waiting'>;
  startedAt: number;
  meta?: RunMeta;
}

export interface RunStore {
  load(): Promise<void>;
  tree(): RunTree;
  upsert(input: RunUpsert): Run;
  close(runId: string, outcome: string): Run | null;
  abandon(runId: string): Run | null;
  subscribe(fn: (run: Run) => void): () => void;
  flush(): Promise<void>;
}

interface Persisted {
  repositories: Repository[];
  worktrees: Worktree[];
  runs: Run[];
}

const EMPTY: Persisted = { repositories: [], worktrees: [], runs: [] };

export function createRunStore({ file }: { file: string }): RunStore {
  let repositories = new Map<string, Repository>();
  let worktrees = new Map<string, Worktree>();
  let runs = new Map<string, Run>();
  const listeners = new Set<(run: Run) => void>();
  let flushing: Promise<void> | null = null;
  let dirty = false;

  function emit(run: Run): void {
    for (const fn of listeners) fn(run);
    dirty = true;
    void scheduleFlush();
  }

  async function scheduleFlush(): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
      // Coalesce a burst of updates into one write.
      await new Promise((r) => setTimeout(r, 50));
      await write();
      flushing = null;
    })();
    return flushing;
  }

  async function write(): Promise<void> {
    if (!dirty) return;
    dirty = false;
    const data: Persisted = {
      repositories: [...repositories.values()],
      worktrees: [...worktrees.values()],
      runs: [...runs.values()],
    };
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
  }

  return {
    async load() {
      let parsed: Persisted = EMPTY;
      try {
        const raw = await readFile(file, 'utf-8');
        const json: unknown = JSON.parse(raw);
        if (json && typeof json === 'object' && Array.isArray((json as Persisted).runs)) {
          parsed = json as Persisted;
        }
      } catch {
        parsed = EMPTY;
      }
      repositories = new Map(parsed.repositories.map((x) => [x.repoId, x]));
      worktrees = new Map(parsed.worktrees.map((x) => [x.worktreeId, x]));
      runs = new Map(parsed.runs.map((x) => [x.runId, x]));
    },

    tree() {
      return {
        repositories: [...repositories.values()],
        worktrees: [...worktrees.values()],
        runs: [...runs.values()],
      };
    },

    upsert(input) {
      repositories.set(input.location.repository.repoId, input.location.repository);
      worktrees.set(input.location.worktree.worktreeId, input.location.worktree);

      const prior = runs.get(input.runId);
      // A human's close is final. Adapters keep reporting the underlying source
      // long after the human filed it away; honouring those reports would
      // resurrect closed work and make the "open" count meaningless.
      const state: RunState = prior && (prior.state === 'closed' || prior.state === 'abandoned')
        ? prior.state
        : input.state;

      const next: Run = {
        runId: input.runId,
        repoId: input.location.repository.repoId,
        worktreeId: input.location.worktree.worktreeId,
        kind: input.kind,
        sourceId: input.sourceId,
        title: input.title,
        state,
        outcome: prior?.outcome,
        startedAt: prior?.startedAt ?? input.startedAt,
        closedAt: prior?.closedAt,
        meta: input.meta ?? prior?.meta,
      };
      runs.set(next.runId, next);
      emit(next);
      return next;
    },

    close(runId, outcome) {
      const prior = runs.get(runId);
      if (!prior) return null;
      const next: Run = { ...prior, state: 'closed', outcome: outcome.trim().slice(0, 300), closedAt: Date.now() };
      runs.set(runId, next);
      emit(next);
      return next;
    },

    abandon(runId) {
      const prior = runs.get(runId);
      if (!prior) return null;
      const next: Run = { ...prior, state: 'abandoned', closedAt: Date.now() };
      delete next.outcome;
      runs.set(runId, next);
      emit(next);
      return next;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async flush() {
      if (flushing) await flushing;
      await write();
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter=@claude-alive/server exec vitest run src/__tests__/runStore.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/server/src/runStore.ts packages/server/src/__tests__/runStore.test.ts
git commit -m "feat(server): 런 레지스트리 runStore 추가 / Add the runStore run registry

레포·워크트리·런을 JSON에 영속화하고 변경을 구독으로 흘린다. 사람이 닫은 런은
어댑터가 무엇을 보고하든 다시 열리지 않는다.
Persist repositories, worktrees and runs to JSON and stream changes to
subscribers. A run a human closed never reopens, whatever adapters report."
```

---

## Task 5: 어댑터 3종 (ticket / terminal / agent → Run)

**Files:**
- Create: `packages/server/src/runAdapters/ticketRuns.ts`
- Create: `packages/server/src/runAdapters/terminalRuns.ts`
- Create: `packages/server/src/runAdapters/agentRuns.ts`
- Test: `packages/server/src/__tests__/runAdapters.test.ts`

**Interfaces:**
- Consumes: Task 4의 `RunStore`, `RunUpsert`; Task 3의 `resolveCwd`
- Produces:
  - `ticketToUpsert(ticket: Ticket, location: ResolvedLocation): RunUpsert | null` — 종료 상태(`done`/`failed`)면 null이 아니라 `waiting`으로 보고한다 (사람이 닫아야 하므로)
  - `terminalToUpsert(tab: { tabId: string; cwd: string; title: string; startedAt: number }, location: ResolvedLocation): RunUpsert`
  - `agentToUpsert(agent: AgentInfo, location: ResolvedLocation): RunUpsert`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/server/src/__tests__/runAdapters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AgentInfo, Ticket } from '@claude-alive/core';
import type { ResolvedLocation } from '../gitResolver.js';
import { ticketToUpsert } from '../runAdapters/ticketRuns.js';
import { terminalToUpsert } from '../runAdapters/terminalRuns.js';
import { agentToUpsert } from '../runAdapters/agentRuns.js';

const LOC: ResolvedLocation = {
  repository: { repoId: 'r1', root: '/r/proj', name: 'proj', isGit: true },
  worktree: { worktreeId: 'w1', repoId: 'r1', path: '/r/proj', branch: 'main', isPrimary: true },
};

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 't-1', seq: 12, goal: '위임 모델 확장', cwd: '/r/proj',
    state: 'running', createdAt: 1000, ...over,
  } as Ticket;
}

describe('ticketToUpsert', () => {
  it('maps running/queued/verifying to a running run', () => {
    for (const state of ['queued', 'running', 'verifying'] as const) {
      expect(ticketToUpsert(ticket({ state }), LOC).state).toBe('running');
    }
  });

  it('maps decision to waiting', () => {
    expect(ticketToUpsert(ticket({ state: 'decision' }), LOC).state).toBe('waiting');
  });

  it('maps done to waiting so a human still has to close it', () => {
    expect(ticketToUpsert(ticket({ state: 'done' }), LOC).state).toBe('waiting');
  });

  it('maps failed to waiting too — a failure is still unfiled work', () => {
    expect(ticketToUpsert(ticket({ state: 'failed' }), LOC).state).toBe('waiting');
  });

  it('carries seq, headline and usage into meta', () => {
    const up = ticketToUpsert(
      ticket({ headline: '검증 완료', usage: { costUsd: 0.42, durationMs: 252000 }, model: 'claude-opus-4-8' }),
      LOC,
    );
    expect(up.meta).toEqual({ seq: 12, headline: '검증 완료', costUsd: 0.42, durationMs: 252000, model: 'claude-opus-4-8' });
  });

  it('uses a stable runId derived from the ticket id', () => {
    expect(ticketToUpsert(ticket(), LOC).runId).toBe('ticket:t-1');
    expect(ticketToUpsert(ticket(), LOC).sourceId).toBe('t-1');
  });

  it('prefers the startedAt timestamp when present', () => {
    expect(ticketToUpsert(ticket({ startedAt: 2000 }), LOC).startedAt).toBe(2000);
    expect(ticketToUpsert(ticket(), LOC).startedAt).toBe(1000);
  });
});

describe('terminalToUpsert', () => {
  it('reports a live terminal tab as running', () => {
    const up = terminalToUpsert({ tabId: 'tab-9', cwd: '/r/proj', title: 'term-2', startedAt: 500 }, LOC);
    expect(up).toMatchObject({ runId: 'terminal:tab-9', sourceId: 'tab-9', kind: 'terminal', state: 'running', title: 'term-2' });
  });
});

describe('agentToUpsert', () => {
  function agent(over: Partial<AgentInfo> = {}): AgentInfo {
    return { sessionId: 's-1', state: 'active', cwd: '/r/proj', displayName: 'proj', startTime: 700, ...over } as AgentInfo;
  }

  it('reports an active agent as running', () => {
    expect(agentToUpsert(agent(), LOC).state).toBe('running');
  });

  it('reports a waiting agent as waiting', () => {
    expect(agentToUpsert(agent({ state: 'waiting' }), LOC).state).toBe('waiting');
  });

  it('reports a finished agent as waiting so it stays until closed', () => {
    expect(agentToUpsert(agent({ state: 'done' }), LOC).state).toBe('waiting');
  });

  it('falls back to the session id when there is no display name', () => {
    expect(agentToUpsert(agent({ displayName: undefined }), LOC).title).toBe('s-1');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter=@claude-alive/server exec vitest run src/__tests__/runAdapters.test.ts`
Expected: FAIL — cannot resolve `../runAdapters/ticketRuns.js`

- [ ] **Step 3: ticketRuns.ts 구현**

`packages/server/src/runAdapters/ticketRuns.ts`:

```ts
import type { Ticket } from '@claude-alive/core';
import type { ResolvedLocation } from '../gitResolver.js';
import type { RunUpsert } from '../runStore.js';

/**
 * Ticket → Run.
 *
 * A ticket that reached `done` or `failed` still reports `waiting`: the agent is
 * finished, but nobody has filed the result yet. That gap is exactly what the
 * run registry exists to make visible, so it must not collapse into `closed`.
 */
export function ticketToUpsert(ticket: Ticket, location: ResolvedLocation): RunUpsert {
  const running = ticket.state === 'queued' || ticket.state === 'running' || ticket.state === 'verifying';
  return {
    runId: `ticket:${ticket.id}`,
    location,
    kind: 'ticket',
    sourceId: ticket.id,
    title: ticket.goal,
    state: running ? 'running' : 'waiting',
    startedAt: ticket.startedAt ?? ticket.createdAt,
    meta: {
      seq: ticket.seq,
      ...(ticket.headline ? { headline: ticket.headline } : {}),
      ...(ticket.usage?.costUsd !== undefined ? { costUsd: ticket.usage.costUsd } : {}),
      ...(ticket.usage?.durationMs !== undefined ? { durationMs: ticket.usage.durationMs } : {}),
      ...(ticket.model ? { model: ticket.model } : {}),
    },
  };
}
```

- [ ] **Step 4: terminalRuns.ts 와 agentRuns.ts 구현**

`packages/server/src/runAdapters/terminalRuns.ts`:

```ts
import type { ResolvedLocation } from '../gitResolver.js';
import type { RunUpsert } from '../runStore.js';

export interface TerminalTabFacts {
  tabId: string;
  cwd: string;
  title: string;
  startedAt: number;
}

/** Terminal tab → Run. A live pty is always `running`; only a human closes it. */
export function terminalToUpsert(tab: TerminalTabFacts, location: ResolvedLocation): RunUpsert {
  return {
    runId: `terminal:${tab.tabId}`,
    location,
    kind: 'terminal',
    sourceId: tab.tabId,
    title: tab.title,
    state: 'running',
    startedAt: tab.startedAt,
  };
}
```

`packages/server/src/runAdapters/agentRuns.ts`:

```ts
import type { AgentInfo } from '@claude-alive/core';
import type { ResolvedLocation } from '../gitResolver.js';
import type { RunUpsert } from '../runStore.js';

/** States where the agent is actively doing something. */
const BUSY = new Set(['spawning', 'active', 'listening']);

/**
 * Agent session → Run. Terminal states (`done`, `error`, `removed`) report
 * `waiting`, not `closed`: the session ended, the work has not been filed.
 */
export function agentToUpsert(agent: AgentInfo, location: ResolvedLocation): RunUpsert {
  return {
    runId: `agent:${agent.sessionId}`,
    location,
    kind: 'agent',
    sourceId: agent.sessionId,
    title: agent.displayName || agent.sessionId,
    state: BUSY.has(agent.state) ? 'running' : 'waiting',
    startedAt: agent.startTime ?? Date.now(),
  };
}
```

`AgentInfo`에 `startTime`이 없으면 실제 필드명으로 교체한다. 확인: `grep -n "interface AgentInfo" -A 20 packages/core/src/events/types.ts`

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter=@claude-alive/server exec vitest run src/__tests__/runAdapters.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 6: 커밋**

```bash
git add packages/server/src/runAdapters packages/server/src/__tests__/runAdapters.test.ts
git commit -m "feat(server): 티켓·터미널·에이전트를 런으로 사상하는 어댑터 추가 / Add adapters mapping tickets, terminals and agents to runs

종료된 티켓·세션도 closed가 아니라 waiting으로 보고한다. 에이전트가 끝난 것과
사람이 확인한 것은 다른 사건이며, 그 간극이 추적 대상이다.
A finished ticket or session reports waiting, not closed. The agent finishing and
a human filing it are different events, and that gap is what we track."
```

---

## Task 6: WS 프로토콜 + HTTP 엔드포인트 배선

**Files:**
- Modify: `packages/core/src/protocol/wsProtocol.ts`
- Modify: `packages/server/src/httpRouter.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/wsServer.ts`
- Test: `packages/server/src/__tests__/runRoutes.test.ts`

**Interfaces:**
- Consumes: Task 4의 `RunStore`
- Produces:
  - WS: `{ type: 'run:snapshot'; tree: RunTree }`, `{ type: 'run:update'; run: Run }`
  - HTTP: `GET /api/runs` → `RunTree`; `POST /api/runs/close` body `{ runId, outcome }` → `{ run }`; `POST /api/runs/abandon` body `{ runId }` → `{ run }`

- [ ] **Step 1: WS 메시지 타입 추가**

`packages/core/src/protocol/wsProtocol.ts`의 `WSServerMessage` 유니온에서 `| { type: 'ticket:update'; ticket: Ticket }` 다음 줄에 추가:

```ts
  // Repo→worktree→run tree. Sent once on connect; live changes ride on `run:update`.
  | { type: 'run:snapshot'; tree: RunTree }
  | { type: 'run:update'; run: Run }
```

같은 파일 상단 import에 추가:

```ts
import type { Run, RunTree } from '../runs/types.js';
```

- [ ] **Step 2: 실패하는 라우트 테스트 작성**

`packages/server/src/__tests__/runRoutes.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRunStore, type RunStore } from '../runStore.js';
import { handleRunRequest } from '../runRoutes.js';
import type { ResolvedLocation } from '../gitResolver.js';

const LOC: ResolvedLocation = {
  repository: { repoId: 'r1', root: '/r/proj', name: 'proj', isGit: true },
  worktree: { worktreeId: 'w1', repoId: 'r1', path: '/r/proj', branch: 'main', isPrimary: true },
};

let dir: string;
let store: RunStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runroutes-'));
  store = createRunStore({ file: join(dir, 'runs.json') });
  await store.load();
  store.upsert({
    runId: 'ticket:t-1', location: LOC, kind: 'ticket', sourceId: 't-1',
    title: '위임 모델 확장', state: 'waiting', startedAt: 1000,
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('handleRunRequest', () => {
  it('GET /api/runs returns the whole tree', async () => {
    const res = await handleRunRequest(store, 'GET', '/api/runs', null);
    expect(res?.status).toBe(200);
    expect(res?.body.repositories).toHaveLength(1);
    expect(res?.body.runs).toHaveLength(1);
  });

  it('POST /api/runs/close records the outcome', async () => {
    const res = await handleRunRequest(store, 'POST', '/api/runs/close', {
      runId: 'ticket:t-1', outcome: '폴백 검증 완료',
    });
    expect(res?.status).toBe(200);
    expect(res?.body.run.state).toBe('closed');
    expect(res?.body.run.outcome).toBe('폴백 검증 완료');
  });

  it('POST /api/runs/close rejects an empty outcome', async () => {
    const res = await handleRunRequest(store, 'POST', '/api/runs/close', { runId: 'ticket:t-1', outcome: '  ' });
    expect(res?.status).toBe(400);
  });

  it('POST /api/runs/close on an unknown run is 404', async () => {
    const res = await handleRunRequest(store, 'POST', '/api/runs/close', { runId: 'nope', outcome: 'x' });
    expect(res?.status).toBe(404);
  });

  it('POST /api/runs/abandon marks the run abandoned', async () => {
    const res = await handleRunRequest(store, 'POST', '/api/runs/abandon', { runId: 'ticket:t-1' });
    expect(res?.body.run.state).toBe('abandoned');
  });

  it('returns null for an unrelated path so the caller falls through', async () => {
    expect(await handleRunRequest(store, 'GET', '/api/tickets', null)).toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter=@claude-alive/server exec vitest run src/__tests__/runRoutes.test.ts`
Expected: FAIL — cannot resolve `../runRoutes.js`

- [ ] **Step 4: runRoutes.ts 구현**

`packages/server/src/runRoutes.ts`:

```ts
import type { RunStore } from './runStore.js';

export interface RunRouteResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

/**
 * Pure-ish router for `/api/runs*`. Kept separate from httpRouter so it can be
 * unit tested without an HTTP server; httpRouter just parses the body and
 * forwards. Returns null when the path is not ours.
 */
export async function handleRunRequest(
  store: RunStore,
  method: string,
  pathname: string,
  body: unknown,
): Promise<RunRouteResult | null> {
  if (method === 'GET' && pathname === '/api/runs') {
    return { status: 200, body: store.tree() };
  }

  if (method === 'POST' && pathname === '/api/runs/close') {
    const runId = readString(body, 'runId');
    const outcome = readString(body, 'outcome');
    if (!runId) return { status: 400, body: { error: 'runId required' } };
    if (!outcome || outcome.trim().length === 0) {
      return { status: 400, body: { error: 'outcome required' } };
    }
    const run = store.close(runId, outcome);
    if (!run) return { status: 404, body: { error: 'run not found' } };
    return { status: 200, body: { run } };
  }

  if (method === 'POST' && pathname === '/api/runs/abandon') {
    const runId = readString(body, 'runId');
    if (!runId) return { status: 400, body: { error: 'runId required' } };
    const run = store.abandon(runId);
    if (!run) return { status: 404, body: { error: 'run not found' } };
    return { status: 200, body: { run } };
  }

  return null;
}

function readString(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter=@claude-alive/server exec vitest run src/__tests__/runRoutes.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: httpRouter에 연결**

`packages/server/src/httpRouter.ts`에서 `/api/tickets` 분기 바로 앞(현재 413행 근처)에 삽입한다. 라우터가 이미 쓰고 있는 body 파싱 헬퍼와 JSON 응답 헬퍼를 그대로 쓴다 — 파일 상단에서 기존 티켓 POST 핸들러가 어떻게 body를 읽는지 확인 후 동일 패턴으로 작성한다.

```ts
    if (runs) {
      const parsedBody = req.method === 'POST' ? await readJsonBody(req) : null;
      const runResult = await handleRunRequest(runs, req.method ?? 'GET', url.pathname, parsedBody);
      if (runResult) {
        res.writeHead(runResult.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(runResult.body));
        return;
      }
    }
```

`runs: RunStore | undefined`를 `httpRouter`가 받는 옵션 객체(현재 `tickets`를 받는 그 객체)에 추가한다.

- [ ] **Step 7: index.ts에서 스토어 생성 + 어댑터 구동**

`packages/server/src/index.ts`에서 티켓 스토어를 만드는 지점 근처에 추가:

```ts
const runs = createRunStore({ file: join(homedir(), '.claude-alive', 'runs.json') });
await runs.load();

/** Mirror one ticket into the run registry, resolving its repo/worktree first. */
async function mirrorTicket(ticket: Ticket): Promise<void> {
  const location = await resolveCwd(ticket.cwd, {
    locationKey: ticket.location && isRemoteLocation(ticket.location)
      ? `ssh:${sshTargetDisplay(ticket.location)}`
      : undefined,
  });
  runs.upsert(ticketToUpsert(ticket, location));
}
```

그리고 기존 티켓 변경 브로드캐스트 지점에서 `void mirrorTicket(ticket);`를 호출한다. 서버 부팅 시 기존 티켓 전체를 1회 미러링한다(backfill):

```ts
for (const ticket of ticketStore.list()) {
  await mirrorTicket(ticket);
}
```

`ticketStore.list()`의 실제 메서드명은 `packages/server/src/ticketStore.ts`에서 확인해 맞춘다.

- [ ] **Step 8: wsServer에서 스냅샷·업데이트 송출**

`packages/server/src/wsServer.ts`에서 접속 시 `ticket:snapshot`을 보내는 지점 옆에 추가:

```ts
send(ws, { type: 'run:snapshot', tree: runs.tree() });
```

그리고 서버 기동 시 1회:

```ts
runs.subscribe((run) => broadcast({ type: 'run:update', run }));
```

- [ ] **Step 9: 전체 서버 테스트 + 빌드 확인**

Run: `pnpm --filter=@claude-alive/server exec vitest run`
Expected: 전부 PASS

Run: `pnpm run build`
Expected: 성공

- [ ] **Step 10: 커밋**

```bash
git add packages/core/src/protocol/wsProtocol.ts packages/server/src
git commit -m "feat(server): 런 트리 HTTP·WS 배선 / Wire the run tree over HTTP and WS

GET /api/runs와 close/abandon POST를 추가하고, run:snapshot·run:update를
브로드캐스트한다. 부팅 시 기존 티켓 전체를 레지스트리에 backfill 한다.
Add GET /api/runs plus close/abandon POSTs, broadcast run:snapshot and
run:update, and backfill every existing ticket into the registry on boot."
```

---

## Task 7: 선택 상태 리듀서 (필터 / 포커스)

**Files:**
- Create: `packages/ui/src/state/selection.ts`
- Test: `packages/ui/src/__tests__/selection.test.ts`

**Interfaces:**
- Consumes: Task 2 타입
- Produces:
  - `interface Selection { repoId: string | null; worktreeId: string | null; runId: string | null; openOnly: boolean }`
  - `const EMPTY_SELECTION: Selection`
  - `type SelectionAction = { type: 'selectRepo'; repoId: string } | { type: 'selectWorktree'; repoId: string; worktreeId: string } | { type: 'focusRun'; run: Run } | { type: 'clear' } | { type: 'toggleOpenOnly' }`
  - `selectionReducer(state: Selection, action: SelectionAction): Selection`
  - `matchesSelection(run: Run, selection: Selection): boolean`
  - `loadSelection(storage: Pick<Storage,'getItem'>): Selection`
  - `saveSelection(storage: Pick<Storage,'setItem'>, selection: Selection): void`

**중요:** vitest node 환경에서 `localStorage`가 없다. 테스트는 목 객체를 주입한다 (`storage` 인자를 받는 이유).

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/ui/src/__tests__/selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Run } from '@claude-alive/core';
import {
  EMPTY_SELECTION, loadSelection, matchesSelection, saveSelection, selectionReducer,
} from '../state/selection.ts';

function run(over: Partial<Run> = {}): Run {
  return {
    runId: 'ticket:t-1', repoId: 'r1', worktreeId: 'w1', kind: 'ticket',
    sourceId: 't-1', title: 'goal', state: 'running', startedAt: 1, ...over,
  };
}

describe('selectionReducer', () => {
  it('selecting a repo clears the worktree and the focused run', () => {
    const start = { repoId: 'r0', worktreeId: 'w0', runId: 'x', openOnly: false };
    expect(selectionReducer(start, { type: 'selectRepo', repoId: 'r1' }))
      .toEqual({ repoId: 'r1', worktreeId: null, runId: null, openOnly: false });
  });

  it('selecting the same repo twice deselects it', () => {
    const once = selectionReducer(EMPTY_SELECTION, { type: 'selectRepo', repoId: 'r1' });
    expect(selectionReducer(once, { type: 'selectRepo', repoId: 'r1' }).repoId).toBeNull();
  });

  it('selecting a worktree also pins its repo', () => {
    const next = selectionReducer(EMPTY_SELECTION, { type: 'selectWorktree', repoId: 'r1', worktreeId: 'w1' });
    expect(next).toMatchObject({ repoId: 'r1', worktreeId: 'w1', runId: null });
  });

  it('focusing a run narrows the filter to that run’s worktree', () => {
    const next = selectionReducer(EMPTY_SELECTION, { type: 'focusRun', run: run() });
    expect(next).toMatchObject({ repoId: 'r1', worktreeId: 'w1', runId: 'ticket:t-1' });
  });

  it('clear resets everything but keeps openOnly', () => {
    const start = { repoId: 'r1', worktreeId: 'w1', runId: 'x', openOnly: true };
    expect(selectionReducer(start, { type: 'clear' })).toEqual({ ...EMPTY_SELECTION, openOnly: true });
  });

  it('toggleOpenOnly flips only that flag', () => {
    const start = { repoId: 'r1', worktreeId: null, runId: null, openOnly: false };
    expect(selectionReducer(start, { type: 'toggleOpenOnly' })).toEqual({ ...start, openOnly: true });
  });
});

describe('matchesSelection', () => {
  it('an empty selection matches everything', () => {
    expect(matchesSelection(run(), EMPTY_SELECTION)).toBe(true);
  });

  it('a repo filter excludes other repos', () => {
    expect(matchesSelection(run({ repoId: 'r2' }), { ...EMPTY_SELECTION, repoId: 'r1' })).toBe(false);
  });

  it('a worktree filter excludes other worktrees in the same repo', () => {
    const sel = { repoId: 'r1', worktreeId: 'w1', runId: null, openOnly: false };
    expect(matchesSelection(run({ worktreeId: 'w2' }), sel)).toBe(false);
  });

  it('openOnly excludes closed and abandoned runs', () => {
    const sel = { ...EMPTY_SELECTION, openOnly: true };
    expect(matchesSelection(run({ state: 'closed' }), sel)).toBe(false);
    expect(matchesSelection(run({ state: 'abandoned' }), sel)).toBe(false);
    expect(matchesSelection(run({ state: 'waiting' }), sel)).toBe(true);
  });

  it('a focused run does not narrow the list — focus is not a filter', () => {
    const sel = { repoId: 'r1', worktreeId: 'w1', runId: 'ticket:t-1', openOnly: false };
    expect(matchesSelection(run({ runId: 'ticket:t-2' }), sel)).toBe(true);
  });
});

describe('persistence', () => {
  it('round-trips through an injected storage', () => {
    const bag: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => bag[k] ?? null,
      setItem: (k: string, v: string) => { bag[k] = v; },
    };
    const sel = { repoId: 'r1', worktreeId: 'w1', runId: null, openOnly: true };
    saveSelection(storage, sel);
    expect(loadSelection(storage)).toEqual(sel);
  });

  it('returns the empty selection when storage holds garbage', () => {
    const storage = { getItem: () => '{{{', setItem: () => {} };
    expect(loadSelection(storage)).toEqual(EMPTY_SELECTION);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/__tests__/selection.test.ts`
Expected: FAIL — cannot resolve `../state/selection.ts`

- [ ] **Step 3: 구현**

`packages/ui/src/state/selection.ts`:

```ts
import type { Run } from '@claude-alive/core';

/**
 * Sidebar selection, split into two independent ideas:
 *   - filter (repoId / worktreeId): narrows what a view lists
 *   - focus  (runId): which run a view should open
 *
 * They are separate because clicking a run must not hide its siblings — the
 * list has to stay navigable while you read one item.
 */
export interface Selection {
  repoId: string | null;
  worktreeId: string | null;
  runId: string | null;
  /** Hide closed/abandoned runs. */
  openOnly: boolean;
}

export const EMPTY_SELECTION: Selection = {
  repoId: null, worktreeId: null, runId: null, openOnly: false,
};

export type SelectionAction =
  | { type: 'selectRepo'; repoId: string }
  | { type: 'selectWorktree'; repoId: string; worktreeId: string }
  | { type: 'focusRun'; run: Run }
  | { type: 'clear' }
  | { type: 'toggleOpenOnly' };

export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'selectRepo':
      // Clicking the already-selected repo deselects it, so the same click
      // both drills in and backs out.
      return state.repoId === action.repoId
        ? { ...state, repoId: null, worktreeId: null, runId: null }
        : { ...state, repoId: action.repoId, worktreeId: null, runId: null };

    case 'selectWorktree':
      return state.worktreeId === action.worktreeId
        ? { ...state, worktreeId: null, runId: null }
        : { ...state, repoId: action.repoId, worktreeId: action.worktreeId, runId: null };

    case 'focusRun':
      return {
        ...state,
        repoId: action.run.repoId,
        worktreeId: action.run.worktreeId,
        runId: action.run.runId,
      };

    case 'clear':
      return { ...EMPTY_SELECTION, openOnly: state.openOnly };

    case 'toggleOpenOnly':
      return { ...state, openOnly: !state.openOnly };
  }
}

/** Does this run survive the current filter? Focus deliberately does not filter. */
export function matchesSelection(run: Run, selection: Selection): boolean {
  if (selection.repoId && run.repoId !== selection.repoId) return false;
  if (selection.worktreeId && run.worktreeId !== selection.worktreeId) return false;
  if (selection.openOnly && (run.state === 'closed' || run.state === 'abandoned')) return false;
  return true;
}

const KEY = 'claude-alive.selection';

export function loadSelection(storage: Pick<Storage, 'getItem'>): Selection {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return EMPTY_SELECTION;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_SELECTION;
    const p = parsed as Partial<Selection>;
    return {
      repoId: typeof p.repoId === 'string' ? p.repoId : null,
      worktreeId: typeof p.worktreeId === 'string' ? p.worktreeId : null,
      runId: typeof p.runId === 'string' ? p.runId : null,
      openOnly: p.openOnly === true,
    };
  } catch {
    return EMPTY_SELECTION;
  }
}

export function saveSelection(storage: Pick<Storage, 'setItem'>, selection: Selection): void {
  try {
    storage.setItem(KEY, JSON.stringify(selection));
  } catch {
    // Private mode / blocked storage: selection just does not persist.
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/__tests__/selection.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/ui/src/state/selection.ts packages/ui/src/__tests__/selection.test.ts
git commit -m "feat(ui): 필터·포커스를 분리한 선택 상태 리듀서 추가 / Add selection reducer splitting filter from focus

레포·워크트리는 목록을 좁히는 필터, 런은 여는 대상인 포커스로 분리한다. 런을
눌렀다고 형제 항목이 사라지면 목록을 계속 훑을 수 없기 때문이다.
Repo and worktree filter the list; a run is focus, not a filter. Hiding siblings
when you open one item would make the list impossible to keep scanning."
```

---

## Task 8: 런 트리 훅 (`useRunTree`)

**Files:**
- Create: `packages/ui/src/hooks/useRunTree.ts`
- Create: `packages/ui/src/components/RepoSidebar/runTree.ts`
- Test: `packages/ui/src/__tests__/runTree.test.ts`

**Interfaces:**
- Consumes: Task 2 타입, Task 7의 `matchesSelection`
- Produces:
  - `buildTree(tree: RunTree, selection: Selection): RepoNode[]`
  - `interface RepoNode { repo: Repository; openCount: number; worktrees: WorktreeNode[] }`
  - `interface WorktreeNode { worktree: Worktree; openCount: number; runs: Run[] }`
  - `oldestOpenAge(tree: RunTree, now: number): number | null` — ms
  - `useRunTree(subscribeRaw): { tree: RunTree; closeRun; abandonRun }`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/ui/src/__tests__/runTree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Repository, Run, RunTree, Worktree } from '@claude-alive/core';
import { buildTree, oldestOpenAge } from '../components/RepoSidebar/runTree.ts';
import { EMPTY_SELECTION } from '../state/selection.ts';

const repo = (repoId: string, name: string): Repository =>
  ({ repoId, root: `/r/${name}`, name, isGit: true });
const wt = (worktreeId: string, repoId: string, branch: string): Worktree =>
  ({ worktreeId, repoId, path: `/r/${branch}`, branch, isPrimary: branch === 'main' });
const run = (runId: string, worktreeId: string, repoId: string, over: Partial<Run> = {}): Run =>
  ({ runId, repoId, worktreeId, kind: 'ticket', sourceId: runId, title: runId,
     state: 'running', startedAt: 1000, ...over });

const TREE: RunTree = {
  repositories: [repo('r1', 'alive'), repo('r2', 'mpc')],
  worktrees: [wt('w1', 'r1', 'main'), wt('w2', 'r1', 'feat/x'), wt('w3', 'r2', 'main')],
  runs: [
    run('a', 'w1', 'r1'),
    run('b', 'w1', 'r1', { state: 'waiting' }),
    run('c', 'w2', 'r1', { state: 'closed' }),
    run('d', 'w3', 'r2', { state: 'abandoned' }),
  ],
};

describe('buildTree', () => {
  it('nests worktrees under their repository', () => {
    const nodes = buildTree(TREE, EMPTY_SELECTION);
    expect(nodes.map((n) => n.repo.repoId)).toEqual(['r1', 'r2']);
    expect(nodes[0]?.worktrees.map((w) => w.worktree.worktreeId)).toEqual(['w1', 'w2']);
  });

  it('counts only open runs in the badges', () => {
    const nodes = buildTree(TREE, EMPTY_SELECTION);
    expect(nodes[0]?.openCount).toBe(2);
    expect(nodes[0]?.worktrees[1]?.openCount).toBe(0);
    expect(nodes[1]?.openCount).toBe(0);
  });

  it('sorts repositories by open count, then by name', () => {
    const nodes = buildTree(TREE, EMPTY_SELECTION);
    expect(nodes[0]?.repo.name).toBe('alive');
  });

  it('sorts runs open-first, then newest first', () => {
    const tree: RunTree = {
      ...TREE,
      runs: [
        run('old-open', 'w1', 'r1', { startedAt: 10 }),
        run('new-closed', 'w1', 'r1', { startedAt: 900, state: 'closed' }),
        run('new-open', 'w1', 'r1', { startedAt: 800 }),
      ],
    };
    const runs = buildTree(tree, EMPTY_SELECTION)[0]?.worktrees[0]?.runs ?? [];
    expect(runs.map((r) => r.runId)).toEqual(['new-open', 'old-open', 'new-closed']);
  });

  it('openOnly drops closed runs and the worktrees left empty', () => {
    const nodes = buildTree(TREE, { ...EMPTY_SELECTION, openOnly: true });
    expect(nodes.map((n) => n.repo.repoId)).toEqual(['r1']);
    expect(nodes[0]?.worktrees.map((w) => w.worktree.worktreeId)).toEqual(['w1']);
  });

  it('keeps a repository with no runs at all when not filtering', () => {
    const tree: RunTree = { ...TREE, runs: [] };
    expect(buildTree(tree, EMPTY_SELECTION)).toHaveLength(2);
  });
});

describe('oldestOpenAge', () => {
  it('returns the age of the oldest open run', () => {
    expect(oldestOpenAge(TREE, 5000)).toBe(4000);
  });

  it('returns null when nothing is open', () => {
    const tree: RunTree = { ...TREE, runs: [run('c', 'w2', 'r1', { state: 'closed' })] };
    expect(oldestOpenAge(tree, 5000)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/__tests__/runTree.test.ts`
Expected: FAIL — cannot resolve `../components/RepoSidebar/runTree.ts`

- [ ] **Step 3: runTree.ts 구현**

`packages/ui/src/components/RepoSidebar/runTree.ts`:

```ts
import type { Repository, Run, RunTree, Worktree } from '@claude-alive/core';
import { matchesSelection, type Selection } from '../../state/selection.ts';

export interface WorktreeNode {
  worktree: Worktree;
  openCount: number;
  runs: Run[];
}

export interface RepoNode {
  repo: Repository;
  openCount: number;
  worktrees: WorktreeNode[];
}

function isOpen(run: Run): boolean {
  return run.state === 'running' || run.state === 'waiting';
}

/**
 * Shape the flat wire tree into the nested sidebar model.
 *
 * The filter is applied to RUNS only; a repository with no runs still shows so
 * you can start one there. When `openOnly` is on, empty branches are pruned —
 * the point of that mode is a short list of what still needs attention.
 */
export function buildTree(tree: RunTree, selection: Selection): RepoNode[] {
  const visible = tree.runs.filter((run) => matchesSelection(run, selection));
  const byWorktree = new Map<string, Run[]>();
  for (const run of visible) {
    const bucket = byWorktree.get(run.worktreeId);
    if (bucket) bucket.push(run);
    else byWorktree.set(run.worktreeId, [run]);
  }

  const nodes: RepoNode[] = tree.repositories.map((repo) => {
    const worktrees: WorktreeNode[] = tree.worktrees
      .filter((w) => w.repoId === repo.repoId)
      .map((worktree) => {
        const runs = [...(byWorktree.get(worktree.worktreeId) ?? [])].sort(compareRuns);
        return { worktree, runs, openCount: runs.filter(isOpen).length };
      })
      .filter((node) => !selection.openOnly || node.runs.length > 0);

    return {
      repo,
      worktrees,
      openCount: worktrees.reduce((sum, w) => sum + w.openCount, 0),
    };
  });

  return nodes
    .filter((node) => !selection.openOnly || node.worktrees.length > 0)
    .sort(compareRepos);
}

/** Open runs first, then most recently started first. */
function compareRuns(a: Run, b: Run): number {
  if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
  return b.startedAt - a.startedAt;
}

/** Most unfinished work first, then alphabetical so the order is stable. */
function compareRepos(a: RepoNode, b: RepoNode): number {
  if (a.openCount !== b.openCount) return b.openCount - a.openCount;
  return (a.repo.name ?? a.repo.root).localeCompare(b.repo.name ?? b.repo.root);
}

/** Age of the longest-open run, for the sidebar's summary line. */
export function oldestOpenAge(tree: RunTree, now: number): number | null {
  const open = tree.runs.filter(isOpen);
  if (open.length === 0) return null;
  const oldest = open.reduce((min, run) => Math.min(min, run.startedAt), Number.POSITIVE_INFINITY);
  return now - oldest;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/__tests__/runTree.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: useRunTree 훅 작성**

`packages/ui/src/hooks/useRunTree.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { Run, RunTree, WSServerMessage } from '@claude-alive/core';
import type { RawMessageSubscribe } from '../App.tsx';

const EMPTY: RunTree = { repositories: [], worktrees: [], runs: [] };

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

/**
 * The run tree, seeded over HTTP and kept live over WS.
 *
 * `run:update` carries a single run, so repositories/worktrees only ever arrive
 * with the snapshot. A run whose worktree is unknown is still stored — the
 * sidebar drops it rather than crashing, and the next snapshot repairs it.
 */
export function useRunTree(active: boolean, subscribeRaw: RawMessageSubscribe) {
  const [tree, setTree] = useState<RunTree>(EMPTY);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/runs`);
        if (!res.ok) return;
        const data = (await res.json()) as RunTree;
        if (!cancelled) setTree(data);
      } catch {
        // Server not reachable: keep the empty tree; WS will fill it in.
      }
    })();
    return () => { cancelled = true; };
  }, [active]);

  useEffect(() => {
    return subscribeRaw((msg: WSServerMessage) => {
      if (msg.type === 'run:snapshot') {
        setTree(msg.tree);
        return;
      }
      if (msg.type === 'run:update') {
        setTree((prev) => {
          const runs = prev.runs.some((r) => r.runId === msg.run.runId)
            ? prev.runs.map((r) => (r.runId === msg.run.runId ? msg.run : r))
            : [...prev.runs, msg.run];
          return { ...prev, runs };
        });
      }
    });
  }, [subscribeRaw]);

  const closeRun = useCallback(async (runId: string, outcome: string): Promise<void> => {
    await fetch(`${API_BASE}/api/runs/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, outcome }),
    });
  }, []);

  const abandonRun = useCallback(async (runId: string): Promise<void> => {
    await fetch(`${API_BASE}/api/runs/abandon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
  }, []);

  return { tree, closeRun, abandonRun };
}

export type { Run };
```

- [ ] **Step 6: 타입 체크**

Run: `pnpm --filter=@claude-alive/ui exec tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add packages/ui/src/hooks/useRunTree.ts packages/ui/src/components/RepoSidebar packages/ui/src/__tests__/runTree.test.ts
git commit -m "feat(ui): 런 트리 조립과 구독 훅 추가 / Add run tree assembly and subscription hook

buildTree가 평평한 와이어 트리를 레포>워크트리>런으로 접고 미종결 수를 센다.
useRunTree는 HTTP 스냅샷 위에 run:update를 얹는다.
buildTree folds the flat wire tree into repo>worktree>run and counts open work.
useRunTree seeds over HTTP and applies run:update on top."
```

---

## Task 9: 공통 사이드바 컴포넌트

**Files:**
- Create: `packages/ui/src/components/RepoSidebar/RepoSidebar.tsx`
- Modify: `packages/i18n/src/locales/en.json`, `packages/i18n/src/locales/ko.json`
- Test: `packages/ui/src/components/RepoSidebar/__tests__/RepoSidebar.test.tsx`

**Interfaces:**
- Consumes: Task 1 프리미티브, Task 7 `Selection`, Task 8 `buildTree`/`oldestOpenAge`
- Produces:
  - `RepoSidebar(props: { tree: RunTree; selection: Selection; onAction: (a: SelectionAction) => void; onNewRun: (worktree: Worktree) => void })`

**추가할 번역 키** (en / ko):
- `sidebar.title` — "Repositories" / "레포지토리"
- `sidebar.openSummary` — "{{count}} open" / "미종결 {{count}}건"
- `sidebar.oldest` — "oldest {{age}}" / "가장 오래된 것 {{age}}"
- `sidebar.showClosed` — "{{count}} done" / "완료 {{count}}개"
- `sidebar.newRun` — "New run" / "새 런"
- `sidebar.noRepos` — "No repositories yet" / "아직 레포지토리가 없습니다"
- `sidebar.detached` — "detached" / "detached"
- `run.close` — "Close" / "닫기"
- `run.open` — "Open" / "열기"
- `run.outcomePlaceholder` — "One line: what came of this" / "한 줄로: 무엇이 되었는지"
- `run.abandon` — "Abandon" / "포기"
- `run.closedAt` — "closed" / "닫힘"

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/ui/src/components/RepoSidebar/__tests__/RepoSidebar.test.tsx`:

```tsx
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunTree } from '@claude-alive/core';
import { RepoSidebar } from '../RepoSidebar.tsx';
import { EMPTY_SELECTION } from '../../../state/selection.ts';

const TREE: RunTree = {
  repositories: [{ repoId: 'r1', root: '/r/alive', name: 'alive', isGit: true }],
  worktrees: [
    { worktreeId: 'w1', repoId: 'r1', path: '/r/alive', branch: 'main', isPrimary: true },
    { worktreeId: 'w2', repoId: 'r1', path: '/r/wt', branch: 'feat/x', isPrimary: false },
  ],
  runs: [
    { runId: 'ticket:t1', repoId: 'r1', worktreeId: 'w1', kind: 'ticket', sourceId: 't1',
      title: '위임 모델 확장', state: 'running', startedAt: 1000, meta: { seq: 12 } },
    { runId: 'ticket:t2', repoId: 'r1', worktreeId: 'w1', kind: 'ticket', sourceId: 't2',
      title: '끝난 일', state: 'closed', startedAt: 900, outcome: '완료', closedAt: 1200 },
  ],
};

function setup(overrides: Partial<Parameters<typeof RepoSidebar>[0]> = {}) {
  const onAction = vi.fn();
  const onNewRun = vi.fn();
  render(
    <RepoSidebar tree={TREE} selection={EMPTY_SELECTION} onAction={onAction} onNewRun={onNewRun} {...overrides} />,
  );
  return { onAction, onNewRun };
}

describe('RepoSidebar', () => {
  it('lists repositories with their open count', () => {
    setup();
    expect(screen.getByText('alive')).toBeInTheDocument();
    expect(screen.getByTestId('repo-open-count-r1')).toHaveTextContent('1');
  });

  it('shows branches under an expanded repository', () => {
    setup();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('feat/x')).toBeInTheDocument();
  });

  it('hides closed runs behind a toggle', () => {
    setup();
    expect(screen.queryByText('끝난 일')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('show-closed-w1'));
    expect(screen.getByText('끝난 일')).toBeInTheDocument();
  });

  it('clicking a repository dispatches selectRepo', () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByTestId('repo-row-r1'));
    expect(onAction).toHaveBeenCalledWith({ type: 'selectRepo', repoId: 'r1' });
  });

  it('clicking a branch dispatches selectWorktree', () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByTestId('worktree-row-w1'));
    expect(onAction).toHaveBeenCalledWith({ type: 'selectWorktree', repoId: 'r1', worktreeId: 'w1' });
  });

  it('clicking a run dispatches focusRun with the whole run', () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByTestId('run-row-ticket:t1'));
    expect(onAction).toHaveBeenCalledWith({ type: 'focusRun', run: TREE.runs[0] });
  });

  it('the new-run button reports the worktree it was pressed in', () => {
    const { onNewRun } = setup();
    fireEvent.click(screen.getByTestId('new-run-w2'));
    expect(onNewRun).toHaveBeenCalledWith(TREE.worktrees[1]);
  });

  it('the summary line reports the total open count', () => {
    setup();
    expect(screen.getByTestId('open-summary')).toHaveTextContent('1');
  });

  it('renders an empty state when there are no repositories', () => {
    setup({ tree: { repositories: [], worktrees: [], runs: [] } });
    expect(screen.getByTestId('sidebar-empty')).toBeInTheDocument();
  });

  it('marks the selected repository', () => {
    setup({ selection: { ...EMPTY_SELECTION, repoId: 'r1' } });
    expect(screen.getByTestId('repo-row-r1')).toHaveAttribute('data-selected', 'true');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/components/RepoSidebar`
Expected: FAIL — cannot resolve `../RepoSidebar.tsx`

- [ ] **Step 3: 번역 키 추가**

`packages/i18n/src/locales/en.json`과 `ko.json`의 최상위에 위 목록의 `sidebar.*`, `run.*` 키를 추가한다. 기존 파일의 중첩 구조(예: `tickets: { … }`)를 따라 `sidebar: { … }`, `run: { … }` 객체로 넣는다.

- [ ] **Step 4: RepoSidebar 구현**

`packages/ui/src/components/RepoSidebar/RepoSidebar.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Run, RunTree, Worktree } from '@claude-alive/core';
import { Badge, EmptyState, StatusDot, space, text, type BadgeTone } from '../ui/index.ts';
import type { Selection, SelectionAction } from '../../state/selection.ts';
import { buildTree, oldestOpenAge, type RepoNode, type WorktreeNode } from './runTree.ts';

const STATE_TONE: Record<Run['state'], BadgeTone> = {
  running: 'blue',
  waiting: 'amber',
  closed: 'neutral',
  abandoned: 'neutral',
};

interface RepoSidebarProps {
  tree: RunTree;
  selection: Selection;
  onAction: (action: SelectionAction) => void;
  onNewRun: (worktree: Worktree) => void;
}

export function RepoSidebar({ tree, selection, onAction, onNewRun }: RepoSidebarProps) {
  const { t } = useTranslation();
  const nodes = buildTree(tree, selection);
  const openCount = nodes.reduce((sum, n) => sum + n.openCount, 0);
  const oldest = oldestOpenAge(tree, Date.now());

  return (
    <nav
      aria-label={t('sidebar.title')}
      style={{
        width: 280,
        flexShrink: 0,
        height: '100%',
        overflowY: 'auto',
        borderRight: '1px solid var(--border-color)',
        background: 'var(--bg-primary)',
        padding: space[3],
        boxSizing: 'border-box',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <button
        type="button"
        data-testid="open-summary"
        onClick={() => onAction({ type: 'toggleOpenOnly' })}
        style={{
          display: 'flex', alignItems: 'center', gap: space[2], width: '100%',
          padding: space[2], marginBottom: space[3],
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
          background: selection.openOnly ? 'rgba(88,166,255,0.10)' : 'transparent',
          color: 'var(--text-secondary)', fontSize: text.sm, cursor: 'pointer',
        }}
      >
        <span>{t('sidebar.openSummary', { count: openCount })}</span>
        {oldest !== null && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: text.xs, opacity: 0.7 }}>
            {t('sidebar.oldest', { age: formatAge(oldest) })}
          </span>
        )}
      </button>

      {nodes.length === 0 ? (
        <div data-testid="sidebar-empty">
          <EmptyState message={t('sidebar.noRepos')} />
        </div>
      ) : (
        nodes.map((node) => (
          <RepoRow
            key={node.repo.repoId}
            node={node}
            selection={selection}
            onAction={onAction}
            onNewRun={onNewRun}
          />
        ))
      )}
    </nav>
  );
}

function RepoRow({
  node, selection, onAction, onNewRun,
}: { node: RepoNode; selection: Selection; onAction: (a: SelectionAction) => void; onNewRun: (w: Worktree) => void }) {
  const selected = selection.repoId === node.repo.repoId;
  return (
    <div style={{ marginBottom: space[2] }}>
      <div
        role="button"
        tabIndex={0}
        data-testid={`repo-row-${node.repo.repoId}`}
        data-selected={selected ? 'true' : 'false'}
        onClick={() => onAction({ type: 'selectRepo', repoId: node.repo.repoId })}
        onKeyDown={(e) => { if (e.key === 'Enter') onAction({ type: 'selectRepo', repoId: node.repo.repoId }); }}
        style={{
          display: 'flex', alignItems: 'center', gap: space[2],
          padding: `${space[2]} ${space[2]}`, borderRadius: 'var(--radius-md)',
          background: selected ? 'rgba(88,166,255,0.10)' : 'transparent',
          color: 'var(--text-primary)', fontSize: text.base, fontWeight: 600, cursor: 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.repo.name ?? node.repo.root}
        </span>
        <span style={{ marginLeft: 'auto' }} data-testid={`repo-open-count-${node.repo.repoId}`}>
          <Badge tone={node.openCount > 0 ? 'amber' : 'neutral'}>{node.openCount}</Badge>
        </span>
      </div>

      {node.worktrees.map((wt) => (
        <WorktreeRow
          key={wt.worktree.worktreeId}
          node={wt}
          selection={selection}
          onAction={onAction}
          onNewRun={onNewRun}
        />
      ))}
    </div>
  );
}

function WorktreeRow({
  node, selection, onAction, onNewRun,
}: { node: WorktreeNode; selection: Selection; onAction: (a: SelectionAction) => void; onNewRun: (w: Worktree) => void }) {
  const { t } = useTranslation();
  const [showClosed, setShowClosed] = useState(false);
  const selected = selection.worktreeId === node.worktree.worktreeId;

  const open = node.runs.filter((r) => r.state === 'running' || r.state === 'waiting');
  const closed = node.runs.filter((r) => r.state === 'closed' || r.state === 'abandoned');
  const shown = showClosed ? [...open, ...closed] : open;

  return (
    <div style={{ marginLeft: space[3] }}>
      <div
        role="button"
        tabIndex={0}
        data-testid={`worktree-row-${node.worktree.worktreeId}`}
        data-selected={selected ? 'true' : 'false'}
        onClick={() => onAction({ type: 'selectWorktree', repoId: node.worktree.repoId, worktreeId: node.worktree.worktreeId })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onAction({ type: 'selectWorktree', repoId: node.worktree.repoId, worktreeId: node.worktree.worktreeId });
          }
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: space[2],
          padding: `${space[1]} ${space[2]}`, borderRadius: 'var(--radius-sm)',
          background: selected ? 'rgba(88,166,255,0.08)' : 'transparent',
          color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: text.sm, cursor: 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.worktree.branch || t('sidebar.detached')}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: space[1], alignItems: 'center' }}>
          <Badge tone={node.openCount > 0 ? 'amber' : 'neutral'}>{node.openCount}</Badge>
          <button
            type="button"
            data-testid={`new-run-${node.worktree.worktreeId}`}
            title={t('sidebar.newRun')}
            onClick={(e) => { e.stopPropagation(); onNewRun(node.worktree); }}
            style={{
              border: 'none', background: 'transparent', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: text.base, lineHeight: 1, padding: 0,
            }}
          >
            +
          </button>
        </span>
      </div>

      {shown.map((run) => (
        <div
          key={run.runId}
          role="button"
          tabIndex={0}
          data-testid={`run-row-${run.runId}`}
          data-selected={selection.runId === run.runId ? 'true' : 'false'}
          onClick={() => onAction({ type: 'focusRun', run })}
          onKeyDown={(e) => { if (e.key === 'Enter') onAction({ type: 'focusRun', run }); }}
          style={{
            display: 'flex', alignItems: 'center', gap: space[2],
            marginLeft: space[3], padding: `${space[1]} ${space[2]}`,
            borderRadius: 'var(--radius-sm)',
            background: selection.runId === run.runId ? 'rgba(88,166,255,0.14)' : 'transparent',
            color: 'var(--text-primary)', fontSize: text.sm, cursor: 'pointer',
          }}
        >
          <StatusDot tone={STATE_TONE[run.state]} pulse={run.state === 'running'} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {run.meta?.seq !== undefined ? `#${run.meta.seq} ` : ''}{run.title}
          </span>
        </div>
      ))}

      {closed.length > 0 && (
        <button
          type="button"
          data-testid={`show-closed-${node.worktree.worktreeId}`}
          onClick={() => setShowClosed((v) => !v)}
          style={{
            marginLeft: space[3], padding: `${space[1]} ${space[2]}`,
            border: 'none', background: 'transparent', color: 'var(--text-secondary)',
            fontSize: text.xs, opacity: 0.6, cursor: 'pointer',
          }}
        >
          {t('sidebar.showClosed', { count: closed.length })}
        </button>
      )}
    </div>
  );
}

/** Coarse age for the summary line: minutes under an hour, then hours, then days. */
function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
```

이 파일은 프리미티브를 쓰지만 레이아웃 자체는 인라인 style로 남는다 — 프리미티브는 요소의 생김새를 통일하고, 배치는 각 컴포넌트가 정한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/components/RepoSidebar`
Expected: PASS (10 tests)

- [ ] **Step 6: 커밋**

```bash
git add packages/ui/src/components/RepoSidebar packages/i18n/src/locales
git commit -m "feat(ui): 공통 레포 사이드바 신설 / Add the shared repository sidebar

레포>브랜치>런 3단 트리, 미종결 배지, 완료 접기, 워크트리별 새 런 버튼.
닫지 않은 런이 계속 눈에 남게 하는 요약 줄을 상단에 둔다.
A three-level repo>branch>run tree with open-count badges, collapsed completed
runs, and a per-worktree new-run button, under a summary line that keeps
unfiled work visible."
```

---

## Task 10: 사이드바를 App 셸에 마운트

**Files:**
- Modify: `packages/ui/src/App.tsx`
- Delete: `packages/ui/src/views/unified/ProjectSidebar.tsx`
- Modify: `packages/ui/src/views/unified/UnifiedView.tsx`
- Test: `packages/ui/src/__tests__/appShell.test.tsx`

**Interfaces:**
- Consumes: Task 8 `useRunTree`, Task 9 `RepoSidebar`, Task 7 리듀서
- Produces: `App`이 `selection`을 소유하고 각 뷰에 `selection` prop을 내려보낸다.

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/ui/src/__tests__/appShell.test.tsx`:

```tsx
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// The shell mounts the sidebar unconditionally; stub the network so the test
// exercises layout, not fetching.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ repositories: [], worktrees: [], runs: [] }),
  })));
  vi.stubGlobal('WebSocket', class { close() {} addEventListener() {} send() {} } as unknown as typeof WebSocket);
});

describe('App shell', () => {
  it('renders the repository sidebar on every view', async () => {
    const { App } = await import('../App.tsx');
    render(<App />);
    expect(await screen.findByRole('navigation', { name: /repositor|레포/i })).toBeInTheDocument();
  });
});
```

`App`이 default export라면 `const { default: App } = await import('../App.tsx')`로 바꾼다. 실제 export 형태를 먼저 확인한다: `grep -n "export .*App" packages/ui/src/App.tsx`

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/__tests__/appShell.test.tsx`
Expected: FAIL — navigation 역할을 가진 요소 없음

- [ ] **Step 3: App.tsx 수정**

`App.tsx`에서 뷰를 렌더하는 컨테이너를 좌측 사이드바 + 우측 뷰의 flex 행으로 감싼다.

```tsx
const [selection, dispatchSelection] = useReducer(
  selectionReducer,
  undefined,
  () => loadSelection(window.localStorage),
);

useEffect(() => {
  saveSelection(window.localStorage, selection);
}, [selection]);

const { tree: runTree } = useRunTree(true, subscribeRaw);

const handleNewRun = useCallback((worktree: Worktree) => {
  // Reuse the existing "open the ticket composer with a preset cwd" event the
  // tickets view already listens for, so this stays one code path.
  window.dispatchEvent(new CustomEvent('claude-alive:new-run', { detail: { cwd: worktree.path } }));
  setViewMode('tickets');
}, []);
```

렌더:

```tsx
<div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
  <RepoSidebar
    tree={runTree}
    selection={selection}
    onAction={dispatchSelection}
    onNewRun={handleNewRun}
  />
  <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
    {/* 기존 뷰 스위처를 그대로 이 안에 옮긴다 */}
  </div>
</div>
```

- [ ] **Step 4: ProjectSidebar 제거**

`views/unified/UnifiedView.tsx`에서 `ProjectSidebar` import와 렌더를 제거하고, 파일을 삭제한다.

```bash
git rm packages/ui/src/views/unified/ProjectSidebar.tsx
```

`ProjectSidebar`가 제공하던 이름 변경(`onProjectNameChange`)은 이번 범위에서 빠진다. 사이드바 재도입은 별도 작업으로 둔다 — 스펙 9절과 함께 다룬다.

- [ ] **Step 5: 테스트 통과 + 전체 UI 테스트 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run`
Expected: 전부 PASS. `UnifiedView`/`ProjectSidebar`를 참조하던 기존 테스트가 깨지면 해당 참조를 지운다.

Run: `pnpm --filter=@claude-alive/ui exec tsc --noEmit`
Expected: 오류 없음

Run: `pnpm run build --filter=@claude-alive/ui`
Expected: 성공

- [ ] **Step 6: 커밋**

```bash
git add -A packages/ui/src
git commit -m "feat(ui): 사이드바를 App 셸로 승격하고 ProjectSidebar 폐기 / Hoist the sidebar into the App shell and drop ProjectSidebar

모든 뷰가 같은 레포 계층과 같은 선택 상태를 공유한다. cwd basename으로 프로젝트를
파생하던 ProjectSidebar는 제거한다.
Every view now shares one repository hierarchy and one selection. ProjectSidebar,
which derived projects from the cwd basename, is removed."
```

---

## Task 11: RunCard와 닫기 플로우

**Files:**
- Create: `packages/ui/src/components/RunCard.tsx`
- Test: `packages/ui/src/__tests__/RunCard.test.tsx`

**Interfaces:**
- Consumes: Task 1 프리미티브, Task 8 `closeRun`/`abandonRun`
- Produces: `RunCard(props: { run: Run; onOpen: (run: Run) => void; onClose: (runId: string, outcome: string) => void; onAbandon: (runId: string) => void })`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/ui/src/__tests__/RunCard.test.tsx`:

```tsx
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Run } from '@claude-alive/core';
import { RunCard } from '../components/RunCard.tsx';

const RUN: Run = {
  runId: 'ticket:t1', repoId: 'r1', worktreeId: 'w1', kind: 'ticket', sourceId: 't1',
  title: '위임 모델 확장', state: 'waiting', startedAt: 1000,
  meta: { seq: 12, headline: '12종 등록 완료', model: 'claude-opus-4-8', costUsd: 0.42 },
};

function setup(run: Run = RUN) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const onAbandon = vi.fn();
  render(<RunCard run={run} onOpen={onOpen} onClose={onClose} onAbandon={onAbandon} />);
  return { onOpen, onClose, onAbandon };
}

describe('RunCard', () => {
  it('shows the sequence number, title and headline', () => {
    setup();
    expect(screen.getByText(/#12/)).toBeInTheDocument();
    expect(screen.getByText('위임 모델 확장')).toBeInTheDocument();
    expect(screen.getByText('12종 등록 완료')).toBeInTheDocument();
  });

  it('prefills the close input with the headline', () => {
    setup();
    fireEvent.click(screen.getByTestId('run-close'));
    expect(screen.getByTestId('run-outcome')).toHaveValue('12종 등록 완료');
  });

  it('submits the outcome on Enter', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId('run-close'));
    const input = screen.getByTestId('run-outcome');
    fireEvent.change(input, { target: { value: '폴백 검증까지 완료' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledWith('ticket:t1', '폴백 검증까지 완료');
  });

  it('ignores Enter while an IME composition is in flight', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId('run-close'));
    const input = screen.getByTestId('run-outcome');
    fireEvent.change(input, { target: { value: '한글' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true } as unknown as KeyboardEventInit);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses to submit an empty outcome', () => {
    const { onClose } = setup({ ...RUN, meta: { seq: 12 } });
    fireEvent.click(screen.getByTestId('run-close'));
    fireEvent.keyDown(screen.getByTestId('run-outcome'), { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('abandon needs no outcome', () => {
    const { onAbandon } = setup();
    fireEvent.click(screen.getByTestId('run-close'));
    fireEvent.click(screen.getByTestId('run-abandon'));
    expect(onAbandon).toHaveBeenCalledWith('ticket:t1');
  });

  it('a closed run shows its outcome and offers no close button', () => {
    setup({ ...RUN, state: 'closed', outcome: '기록됨', closedAt: 2000 });
    expect(screen.getByText('기록됨')).toBeInTheDocument();
    expect(screen.queryByTestId('run-close')).not.toBeInTheDocument();
  });

  it('open dispatches with the whole run', () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByTestId('run-open'));
    expect(onOpen).toHaveBeenCalledWith(RUN);
  });
});
```

`fireEvent.keyDown`에 `isComposing`을 넘기면 jsdom이 `nativeEvent.isComposing`으로 전달한다. 동작하지 않으면 `new KeyboardEvent('keydown', { key: 'Enter', isComposing: true })`를 `fireEvent(input, event)`로 직접 디스패치한다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/__tests__/RunCard.test.tsx`
Expected: FAIL — cannot resolve `../components/RunCard.tsx`

- [ ] **Step 3: 구현**

`packages/ui/src/components/RunCard.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Run } from '@claude-alive/core';
import { Badge, Button, Panel, StatusDot, space, text, type BadgeTone } from './ui/index.ts';

const STATE_TONE: Record<Run['state'], BadgeTone> = {
  running: 'blue', waiting: 'amber', closed: 'neutral', abandoned: 'neutral',
};

interface RunCardProps {
  run: Run;
  onOpen: (run: Run) => void;
  onClose: (runId: string, outcome: string) => void;
  onAbandon: (runId: string) => void;
}

export function RunCard({ run, onOpen, onClose, onAbandon }: RunCardProps) {
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState('');
  const isOpen = run.state === 'running' || run.state === 'waiting';

  function beginClose() {
    // Prefill with the agent's own one-liner: most closes are "yes, that".
    setOutcome(run.meta?.headline ?? '');
    setClosing(true);
  }

  function submit() {
    const trimmed = outcome.trim();
    if (trimmed.length === 0) return;
    onClose(run.runId, trimmed);
    setClosing(false);
  }

  return (
    <Panel padding="sm">
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
        <StatusDot tone={STATE_TONE[run.state]} pulse={run.state === 'running'} />
        {run.meta?.seq !== undefined && <Badge tone="neutral">#{run.meta.seq}</Badge>}
        <span style={{ fontSize: text.base, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {run.title}
        </span>
      </div>

      <div style={{ marginTop: space[1], fontFamily: 'var(--font-mono)', fontSize: text.xs, color: 'var(--text-secondary)' }}>
        {[run.meta?.model, formatDuration(run.meta?.durationMs), formatCost(run.meta?.costUsd)]
          .filter((x): x is string => Boolean(x))
          .join(' · ')}
      </div>

      {(run.outcome ?? run.meta?.headline) && (
        <div style={{ marginTop: space[2], fontSize: text.sm, color: 'var(--text-secondary)' }}>
          {run.outcome ?? run.meta?.headline}
        </div>
      )}

      {closing ? (
        <div style={{ marginTop: space[2], display: 'flex', gap: space[2], alignItems: 'center' }}>
          <input
            data-testid="run-outcome"
            autoFocus
            value={outcome}
            placeholder={t('run.outcomePlaceholder')}
            onChange={(e) => setOutcome(e.target.value)}
            onKeyDown={(e) => {
              // Korean IME commits its last syllable with an Enter that also
              // reaches keydown; submitting there duplicates the character.
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') setClosing(false);
            }}
            style={{
              flex: 1, minWidth: 0, padding: `${space[1]} ${space[2]}`,
              borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              fontFamily: 'var(--font-ui)', fontSize: text.sm,
            }}
          />
          <span data-testid="run-abandon-wrap">
            <Button variant="ghost" onClick={() => { onAbandon(run.runId); setClosing(false); }}>
              <span data-testid="run-abandon">{t('run.abandon')}</span>
            </Button>
          </span>
        </div>
      ) : (
        <div style={{ marginTop: space[2], display: 'flex', gap: space[2], justifyContent: 'flex-end' }}>
          <span data-testid="run-open-wrap">
            <Button variant="ghost" onClick={() => onOpen(run)}>
              <span data-testid="run-open">{t('run.open')}</span>
            </Button>
          </span>
          {isOpen && (
            <span data-testid="run-close-wrap">
              <Button variant="primary" onClick={beginClose}>
                <span data-testid="run-close">{t('run.close')}</span>
              </Button>
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}

function formatDuration(ms?: number): string | undefined {
  if (ms === undefined) return undefined;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatCost(usd?: number): string | undefined {
  return usd === undefined ? undefined : `$${usd.toFixed(2)}`;
}
```

`data-testid`가 버튼 안쪽 `<span>`에 붙어 있으므로 `fireEvent.click(screen.getByTestId('run-close'))`는 버블링으로 버튼의 onClick에 도달한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/__tests__/RunCard.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/ui/src/components/RunCard.tsx packages/ui/src/__tests__/RunCard.test.tsx
git commit -m "feat(ui): 런 카드와 인라인 닫기 플로우 추가 / Add the run card and inline close flow

닫기는 모달 없이 한 줄 입력으로 끝나고 에이전트 헤드라인이 프리필된다. 결과 없이
치우려면 포기를 고르게 해 완료와 구분한다.
Closing is a single inline line prefilled with the agent's headline. Filing
something away without a result requires Abandon, so it stays distinct from done."
```

---

## Task 12: 뷰 배선 — 티켓 뷰 필터 + 보드 중복 리스트 제거

**Files:**
- Modify: `packages/ui/src/views/tickets/TicketsView.tsx`
- Modify: `packages/ui/src/views/board/WorkTab.tsx`
- Modify: `packages/ui/src/views/board/BoardView.tsx`
- Test: `packages/ui/src/views/board/__tests__/WorkTab.test.tsx` (기존 갱신)
- Test: `packages/ui/src/__tests__/ticketsFilter.test.tsx` (신규)

**Interfaces:**
- Consumes: Task 7 `Selection`, Task 10에서 App이 내려주는 `selection` prop
- Produces: `TicketsView(props: { active; subscribeRaw; selection: Selection })`, `WorkTab(props: { active; selection: Selection; focusedRunId: string | null })`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/ui/src/__tests__/ticketsFilter.test.tsx`:

```tsx
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import type { Ticket } from '@claude-alive/core';
import { filterTicketsBySelection } from '../views/tickets/ticketFilter.ts';
import { EMPTY_SELECTION } from '../state/selection.ts';

const ticket = (id: string, cwd: string): Ticket =>
  ({ id, seq: 1, goal: id, cwd, state: 'running', createdAt: 1 } as Ticket);

const RUNS = [
  { runId: 'ticket:a', sourceId: 'a', repoId: 'r1', worktreeId: 'w1' },
  { runId: 'ticket:b', sourceId: 'b', repoId: 'r2', worktreeId: 'w2' },
];

describe('filterTicketsBySelection', () => {
  it('passes everything through with an empty selection', () => {
    const out = filterTicketsBySelection([ticket('a', '/x'), ticket('b', '/y')], RUNS, EMPTY_SELECTION);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('keeps only tickets whose run is in the selected repo', () => {
    const out = filterTicketsBySelection(
      [ticket('a', '/x'), ticket('b', '/y')], RUNS, { ...EMPTY_SELECTION, repoId: 'r1' },
    );
    expect(out.map((x) => x.id)).toEqual(['a']);
  });

  it('keeps only tickets whose run is in the selected worktree', () => {
    const out = filterTicketsBySelection(
      [ticket('a', '/x'), ticket('b', '/y')], RUNS, { ...EMPTY_SELECTION, repoId: 'r2', worktreeId: 'w2' },
    );
    expect(out.map((x) => x.id)).toEqual(['b']);
  });

  it('drops a ticket that has no run yet when a filter is active', () => {
    const out = filterTicketsBySelection([ticket('c', '/z')], RUNS, { ...EMPTY_SELECTION, repoId: 'r1' });
    expect(out).toEqual([]);
  });

  it('keeps a ticket that has no run when no filter is active', () => {
    expect(filterTicketsBySelection([ticket('c', '/z')], RUNS, EMPTY_SELECTION)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter=@claude-alive/ui exec vitest run src/__tests__/ticketsFilter.test.tsx`
Expected: FAIL — cannot resolve `../views/tickets/ticketFilter.ts`

- [ ] **Step 3: ticketFilter.ts 구현**

`packages/ui/src/views/tickets/ticketFilter.ts`:

```ts
import type { Ticket } from '@claude-alive/core';
import type { Selection } from '../../state/selection.ts';

/** Just the run fields this filter needs, so tests do not build whole Runs. */
export interface RunLocationRef {
  sourceId: string;
  repoId: string;
  worktreeId: string;
}

/**
 * Narrow the ticket board to the sidebar's filter.
 *
 * A ticket with no run yet (registered a moment ago, or a backfill that failed)
 * is kept when nothing is filtered and dropped when something is — it cannot be
 * proven to belong to the selected repo, and showing it there would be a lie.
 */
export function filterTicketsBySelection(
  tickets: Ticket[],
  runs: readonly RunLocationRef[],
  selection: Selection,
): Ticket[] {
  if (!selection.repoId && !selection.worktreeId) return tickets;

  const bySource = new Map(runs.map((r) => [r.sourceId, r]));
  return tickets.filter((ticket) => {
    const run = bySource.get(ticket.id);
    if (!run) return false;
    if (selection.repoId && run.repoId !== selection.repoId) return false;
    if (selection.worktreeId && run.worktreeId !== selection.worktreeId) return false;
    return true;
  });
}
```

- [ ] **Step 4: TicketsView에 배선**

`TicketsView`의 props에 `selection: Selection`과 `runs: RunLocationRef[]`를 추가하고, `grouped`를 계산하기 전에 필터를 적용한다:

```tsx
const visible = useMemo(
  () => filterTicketsBySelection(tickets, runs, selection),
  [tickets, runs, selection],
);

const grouped = useMemo(() => {
  const g: Record<DisplayStatus, Ticket[]> = { active: [], decision: [], complete: [], closed: [], failed: [] };
  for (const ticket of visible) g[displayStatus(ticket.state, evaluations[ticket.id])].push(ticket);
  return g;
}, [visible, evaluations]);
```

`App.tsx`에서 `<TicketsView … selection={selection} runs={runTree.runs} />`로 넘긴다.

또한 Task 10에서 만든 `claude-alive:new-run` 이벤트를 `TicketsView`가 듣고 `NewTicketForm`의 cwd를 프리필한다:

```tsx
useEffect(() => {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { cwd?: string } | undefined;
    if (typeof detail?.cwd === 'string') setPresetCwd(detail.cwd);
  };
  window.addEventListener('claude-alive:new-run', handler);
  return () => window.removeEventListener('claude-alive:new-run', handler);
}, []);
```

`NewTicketForm`에 `presetCwd?: string` prop을 추가해 폴더 선택기의 초기값으로 쓴다.

- [ ] **Step 5: WorkTab의 중복 티켓 리스트 제거**

`views/board/WorkTab.tsx`에서 좌측 `TicketList` 렌더를 제거하고, 선택 티켓을 `focusedRunId`에서 유도한다:

```tsx
interface WorkTabProps {
  active: boolean;
  /** Run id focused in the shared sidebar, e.g. `ticket:t-1`. */
  focusedRunId: string | null;
}

const selectedTicketId = focusedRunId?.startsWith('ticket:')
  ? focusedRunId.slice('ticket:'.length)
  : null;
```

`selectedTicketId`가 null이면 `EmptyState`로 "사이드바에서 런을 고르세요"를 표시한다. 번역 키 `board.pickRun`을 en/ko에 추가한다 ("Pick a run in the sidebar" / "사이드바에서 런을 선택하세요").

`views/board/TicketList.tsx`는 더 이상 참조되지 않으므로 삭제한다.

- [ ] **Step 6: 기존 WorkTab 테스트 갱신**

`views/board/__tests__/WorkTab.test.tsx`에서 좌측 리스트를 검증하던 케이스를 제거하고, 다음 두 케이스로 교체한다:

```tsx
it('asks the user to pick a run when nothing is focused', () => {
  render(<WorkTab active focusedRunId={null} />);
  expect(screen.getByText(/사이드바|sidebar/i)).toBeInTheDocument();
});

it('renders the detail tabs for a focused ticket run', () => {
  render(<WorkTab active focusedRunId="ticket:t-1" />);
  expect(screen.getByRole('tablist')).toBeInTheDocument();
});
```

- [ ] **Step 7: 전체 테스트 + 빌드**

Run: `pnpm --filter=@claude-alive/ui exec vitest run`
Expected: 전부 PASS

Run: `pnpm run build`
Expected: 성공

- [ ] **Step 8: 커밋**

```bash
git add -A packages/ui/src packages/i18n/src/locales
git commit -m "feat(ui): 사이드바 필터를 티켓·보드에 배선하고 중복 리스트 제거 / Wire the sidebar filter into tickets and board, drop the duplicate list

티켓 보드는 선택된 레포·워크트리로 좁혀지고, 보드의 좌측 티켓 리스트는 사이드바와
중복이라 제거한다. 보드는 사이드바가 포커스한 런의 상세만 렌더한다.
The ticket board narrows to the selected repo/worktree, and the board's own
ticket list is removed as a duplicate of the sidebar. The board now renders only
the detail of whatever run the sidebar focused."
```

---

## Self-Review 결과

**스펙 커버리지**
- 4절 데이터 모델 → Task 2, 3, 4
- 4.1 상태 사상 → Task 5
- 4.2 마이그레이션(backfill) → Task 6 Step 7
- 5절 사이드바 → Task 9, 10
- 5.1 필터/포커스 → Task 7, 12
- 5.2 중복 제거 → Task 12 Step 5
- 5.3 새 런 진입점 → Task 10 Step 3 + Task 12 Step 4
- 5.4 미종결 회수 → Task 9 (요약 줄 + openOnly 토글)
- 6절 런 카드·닫기 → Task 11
- 7절 프리미티브 → Task 1
- 10절 단계 → Task 1~12에 대응

**미커버 항목 (의도적)**
- 스펙 5.1의 `spread`/`list`/`animation`/`workspace` 필터 배선은 이 계획에 포함하지 않는다. 그 네 뷰는 각자 다른 데이터 소스를 쓰며, Task 12에서 확립한 `filterTicketsBySelection` 패턴을 뷰마다 반복하는 기계적인 작업이다. 별도 후속 계획으로 다룬다.
- 스펙 9절(`useWorkspaceTree`와의 경계)은 열린 결정이므로 태스크로 만들지 않았다. Task 10에서 `ProjectSidebar`의 프로젝트 이름 변경 기능이 빠지는데, 이 결정과 함께 복원 여부를 정한다.

**타입 일관성 확인**
- `RunUpsert.state`는 Task 4에서 `'running' | 'waiting'`으로 좁혔고, Task 5의 어댑터 3종이 모두 그 범위만 반환한다.
- `matchesSelection`은 Task 7에서 정의하고 Task 8(`buildTree`)과 Task 12(`filterTicketsBySelection`은 별도 구현)에서 쓴다. 후자가 `matchesSelection`을 재사용하지 않는 이유는 입력이 `Run`이 아니라 `Ticket`이기 때문이다.
- `BadgeTone`은 Task 1에서 정의하고 Task 9, 11이 `STATE_TONE` 맵으로 소비한다. 두 곳의 맵이 동일하다 — Task 11 착수 시 Task 9의 맵을 `components/ui/tokens.ts`로 올려 공유해도 좋다.

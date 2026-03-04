# Dashboard Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** claude-alive에 에이전트 호출 통계, 토큰 사용량 추적, 내장 터미널 3가지 기능을 점진적으로 추가한다.

**Architecture:** 기존 Hook→Server→WebSocket→UI 파이프라인을 확장. Phase 1은 기존 SessionStore에 집계 로직 추가, Phase 2는 transcript JSONL 파싱 모듈 신규 생성, Phase 3는 node-pty + xterm.js로 별도 WS 채널 구축.

**Tech Stack:** TypeScript, Vitest, React 19, xterm.js, node-pty, i18next

---

## Phase 1: Agent Call Statistics

### Task 1: AgentInfo에 toolCallCount 필드 추가

**Files:**
- Modify: `packages/core/src/events/types.ts:60-83`
- Modify: `packages/core/src/state/sessionStore.ts:127-153`
- Test: `packages/core/src/__tests__/sessionStore.test.ts`

**Step 1: Write the failing test**

`packages/core/src/__tests__/sessionStore.test.ts` 맨 끝, `describe('totalEvents counter')` 블록 뒤에 추가:

```typescript
describe('toolCallCount', () => {
  it('increments toolCallCount on PreToolUse', () => {
    store.processEvent(makePayload('SessionStart', 'sess-1'));
    store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Write' }));
    store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Bash' }));
    store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Write' }));
    expect(store.getAgent('sess-1')!.toolCallCount).toBe(3);
  });

  it('starts at 0', () => {
    store.processEvent(makePayload('SessionStart', 'sess-1'));
    expect(store.getAgent('sess-1')!.toolCallCount).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm --filter=@claude-alive/core test`
Expected: FAIL — `toolCallCount` property does not exist

**Step 3: Write minimal implementation**

In `packages/core/src/events/types.ts`, add to `AgentInfo` interface after `toolsUsed: string[]` (line 82):

```typescript
/** Total tool call count (including duplicates) */
toolCallCount: number;
```

In `packages/core/src/state/sessionStore.ts`, in `createAgent` method (line 127-153), add to the `agent` object after `toolsUsed: []`:

```typescript
toolCallCount: 0,
```

In `processEvent` method, after `agent.totalEvents++` (line 85), add:

```typescript
if (event === 'PreToolUse') {
  agent.toolCallCount++;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm --filter=@claude-alive/core test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/core/src/events/types.ts packages/core/src/state/sessionStore.ts packages/core/src/__tests__/sessionStore.test.ts
git commit -m "feat(core): add toolCallCount to AgentInfo"
```

---

### Task 2: SessionStore에 getStats() 메서드 추가

**Files:**
- Modify: `packages/core/src/state/sessionStore.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/sessionStore.test.ts`

**Step 1: Write the failing test**

`packages/core/src/__tests__/sessionStore.test.ts` 끝에 추가:

```typescript
describe('getStats', () => {
  it('returns aggregate stats', () => {
    store.processEvent(makePayload('SessionStart', 'sess-1'));
    store.processEvent(makePayload('SubagentStart', 'sess-1', { agent_id: 'sub-1', agent_type: 'Explore' }));
    store.processEvent(makePayload('SubagentStart', 'sess-1', { agent_id: 'sub-2', agent_type: 'Explore' }));
    store.processEvent(makePayload('SubagentStart', 'sess-1', { agent_id: 'sub-3', agent_type: 'Plan' }));
    store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Write' }));
    store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Bash' }));
    store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Write' }));

    const stats = store.getStats();
    expect(stats.totalAgents).toBe(4);
    expect(stats.activeAgents).toBe(4);
    expect(stats.subagentsByType).toEqual({ Explore: 2, Plan: 1 });
    expect(stats.toolCallsByName['Write']).toBe(2);
    expect(stats.toolCallsByName['Bash']).toBe(1);
  });

  it('excludes despawning/removed agents from activeAgents', () => {
    store.processEvent(makePayload('SessionStart', 'sess-1'));
    store.processEvent(makePayload('SessionStart', 'sess-2'));
    store.processEvent(makePayload('SessionEnd', 'sess-2'));
    const stats = store.getStats();
    expect(stats.totalAgents).toBe(2);
    expect(stats.activeAgents).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm --filter=@claude-alive/core test`
Expected: FAIL — `getStats is not a function`

**Step 3: Write minimal implementation**

In `packages/core/src/state/sessionStore.ts`, add the `AgentStats` interface at the top (after `EventLogEntry` interface, before `SessionStore` class):

```typescript
export interface AgentStats {
  totalAgents: number;
  activeAgents: number;
  subagentsByType: Record<string, number>;
  toolCallsByName: Record<string, number>;
}
```

Add `getStats()` method to `SessionStore` class, after `getCompletedSessions()`:

```typescript
getStats(): AgentStats {
  const agents = this.getAllAgents();
  const subagentsByType: Record<string, number> = {};
  const toolCallsByName: Record<string, number> = {};
  let activeAgents = 0;

  for (const agent of agents) {
    if (agent.state !== 'despawning' && agent.state !== 'removed') {
      activeAgents++;
    }
    if (agent.parentId && agent.displayName) {
      subagentsByType[agent.displayName] = (subagentsByType[agent.displayName] ?? 0) + 1;
    }
    for (const tool of agent.toolsUsed) {
      toolCallsByName[tool] = (toolCallsByName[tool] ?? 0) + agent.toolCallCount;
    }
  }

  return { totalAgents: agents.length, activeAgents, subagentsByType, toolCallsByName };
}
```

Note: the above `toolCallsByName` logic needs refining — `toolsUsed` is a list of unique tool names, not per-tool counts. We need a separate per-tool counter. Revise:

In `packages/core/src/events/types.ts`, add to `AgentInfo` after `toolCallCount`:

```typescript
/** Per-tool call counts */
toolCallCounts: Record<string, number>;
```

In `sessionStore.ts` `createAgent`, add after `toolCallCount: 0`:

```typescript
toolCallCounts: {},
```

In `processEvent`, replace the `toolCallCount` increment with:

```typescript
if (event === 'PreToolUse' && toolName) {
  agent.toolCallCount++;
  const displayName = extractToolDisplayName(toolName);
  agent.toolCallCounts[displayName] = (agent.toolCallCounts[displayName] ?? 0) + 1;
}
```

Then `getStats()` becomes:

```typescript
getStats(): AgentStats {
  const agents = this.getAllAgents();
  const subagentsByType: Record<string, number> = {};
  const toolCallsByName: Record<string, number> = {};
  let activeAgents = 0;

  for (const agent of agents) {
    if (agent.state !== 'despawning' && agent.state !== 'removed') {
      activeAgents++;
    }
    if (agent.parentId && agent.displayName) {
      subagentsByType[agent.displayName] = (subagentsByType[agent.displayName] ?? 0) + 1;
    }
    for (const [tool, count] of Object.entries(agent.toolCallCounts)) {
      toolCallsByName[tool] = (toolCallsByName[tool] ?? 0) + count;
    }
  }

  return { totalAgents: agents.length, activeAgents, subagentsByType, toolCallsByName };
}
```

Export `AgentStats` from `packages/core/src/index.ts`:

```typescript
export type { AgentStats } from './state/sessionStore.js';
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm --filter=@claude-alive/core test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/core/src/events/types.ts packages/core/src/state/sessionStore.ts packages/core/src/__tests__/sessionStore.test.ts packages/core/src/index.ts
git commit -m "feat(core): add getStats() with subagent/tool aggregation"
```

---

### Task 3: 서버에 stats API + WS 메시지 추가

**Files:**
- Modify: `packages/server/src/httpRouter.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/core/src/protocol/wsProtocol.ts`

**Step 1: WSServerMessage에 stats:update 타입 추가**

In `packages/core/src/protocol/wsProtocol.ts`, import `AgentStats` and add to the union:

```typescript
import type { AgentStats } from '../state/sessionStore.js';

// Add to WSServerMessage union:
| { type: 'stats:update'; stats: AgentStats }
```

Also update the `snapshot` message type to include stats:

```typescript
| { type: 'snapshot'; agents: AgentInfo[]; recentEvents: EventLogEntry[]; completedSessions: CompletedSession[]; stats: AgentStats }
```

**Step 2: httpRouter에 GET /api/stats 추가**

In `packages/server/src/httpRouter.ts`, add `getStats` to `HttpRouterOptions`:

```typescript
export interface HttpRouterOptions {
  // ... existing
  getStats: () => object;
}
```

Add route handler before the health check:

```typescript
if (req.method === 'GET' && url.pathname === '/api/stats') {
  sendJson(res, 200, options.getStats(), req);
  return;
}
```

**Step 3: server/index.ts에서 stats를 snapshot과 broadcast에 포함**

In `packages/server/src/index.ts`:

Update `getSnapshot()`:
```typescript
function getSnapshot() {
  return {
    agents: store.getAllAgents(),
    recentEvents: store.getRecentEvents(100),
    completedSessions: store.getCompletedSessions(),
    stats: store.getStats(),
  };
}
```

Update `createHttpServer` call to pass `getStats`:
```typescript
const httpServer = createHttpServer({ onEvent, getSnapshot, renameAgent, removeAgent, getStats: () => store.getStats() });
```

Add `stats:update` broadcast in `onEvent()`, at the end of the function:
```typescript
broadcaster.broadcast({ type: 'stats:update', stats: store.getStats() });
```

**Step 4: Build and verify**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add packages/core/src/protocol/wsProtocol.ts packages/server/src/httpRouter.ts packages/server/src/index.ts
git commit -m "feat(server): add stats API endpoint and WS broadcast"
```

---

### Task 4: UI에 AgentStats 컴포넌트 추가

**Files:**
- Create: `packages/ui/src/views/dashboard/components/AgentStats.tsx`
- Modify: `packages/ui/src/views/unified/RightPanel.tsx`
- Modify: `packages/ui/src/views/dashboard/hooks/useWebSocket.ts`
- Modify: `packages/i18n/src/locales/en.json`
- Modify: `packages/i18n/src/locales/ko.json`

**Step 1: useWebSocket에 stats 상태 추가**

In `packages/ui/src/views/dashboard/hooks/useWebSocket.ts`:

Add `AgentStats` import from `@claude-alive/core`, add to `DashboardState`:

```typescript
import type { AgentInfo, AgentState, CompletedSession, ToolAnimation, EventLogEntry, WSServerMessage, AgentStats } from '@claude-alive/core';

export interface DashboardState {
  agents: Map<string, AgentInfo>;
  events: EventLogEntry[];
  completedSessions: CompletedSession[];
  stats: AgentStats | null;
  connected: boolean;
}
```

Update initial state:
```typescript
const [state, setState] = useState<DashboardState>({
  agents: new Map(),
  events: [],
  completedSessions: [],
  stats: null,
  connected: false,
});
```

Add cases in the switch statement:

```typescript
case 'snapshot': {
  // ... existing code
  return { agents, events, completedSessions, stats: msg.stats ?? null, connected: true };
}

case 'stats:update': {
  return { ...prev, stats: msg.stats };
}
```

**Step 2: i18n 키 추가**

In `packages/i18n/src/locales/en.json`, add `stats` section:

```json
"stats": {
  "title": "Agent Stats",
  "active": "Active",
  "total": "Total",
  "subagentTypes": "Sub-agent Types",
  "topTools": "Top Tools",
  "calls": "calls",
  "noData": "No activity yet"
}
```

In `packages/i18n/src/locales/ko.json`, add:

```json
"stats": {
  "title": "에이전트 통계",
  "active": "활성",
  "total": "전체",
  "subagentTypes": "서브에이전트 유형",
  "topTools": "주요 도구",
  "calls": "호출",
  "noData": "아직 활동 없음"
}
```

**Step 3: AgentStats 컴포넌트 작성**

Create `packages/ui/src/views/dashboard/components/AgentStats.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { AgentStats as AgentStatsType } from '@claude-alive/core';

interface AgentStatsProps {
  stats: AgentStatsType | null;
}

export function AgentStats({ stats }: AgentStatsProps) {
  const { t } = useTranslation();

  if (!stats || stats.totalAgents === 0) return null;

  const topTools = Object.entries(stats.toolCallsByName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const subagentTypes = Object.entries(stats.subagentsByType)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div
      className="border rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <div
        className="px-5 py-4 text-[13px] font-semibold border-b flex items-center justify-between"
        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}
      >
        <span>{t('stats.title')}</span>
        <div className="flex items-center gap-3 text-[11px]">
          <span>
            <span style={{ color: 'var(--accent-green)' }}>{stats.activeAgents}</span>
            {' '}{t('stats.active')}
          </span>
          <span>
            <span style={{ color: 'var(--text-primary)' }}>{stats.totalAgents}</span>
            {' '}{t('stats.total')}
          </span>
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        {/* Sub-agent types */}
        {subagentTypes.length > 0 && (
          <div>
            <div className="text-[11px] font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              {t('stats.subagentTypes')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {subagentTypes.map(([type, count]) => (
                <span
                  key={type}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium"
                  style={{ background: 'var(--accent-purple)15', color: 'var(--accent-purple)' }}
                >
                  {type} ×{count}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Top tools */}
        {topTools.length > 0 && (
          <div>
            <div className="text-[11px] font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              {t('stats.topTools')}
            </div>
            <div className="space-y-1">
              {topTools.map(([tool, count]) => (
                <div key={tool} className="flex items-center justify-between text-[12px]">
                  <span style={{ color: 'var(--text-primary)' }}>{tool}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{count} {t('stats.calls')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 4: RightPanel에 AgentStats 삽입**

In `packages/ui/src/views/unified/RightPanel.tsx`:

```tsx
import type { AgentInfo, CompletedSession, EventLogEntry, AgentStats as AgentStatsType } from '@claude-alive/core';
import { AgentStats } from '../dashboard/components/AgentStats.tsx';
// ... existing imports

interface RightPanelProps {
  events: EventLogEntry[];
  agents: AgentInfo[];
  completedSessions: CompletedSession[];
  stats: AgentStatsType | null;
}

export function RightPanel({ events, agents, completedSessions, stats }: RightPanelProps) {
  return (
    <div /* ... existing wrapper ... */>
      {/* Agent Stats — new, first section */}
      <div className="shrink-0 p-4 pb-0">
        <AgentStats stats={stats} />
      </div>

      {/* Activity Pulse — existing */}
      <div className="shrink-0 p-4 pb-0">
        <ActivityPulse events={events} />
      </div>
      {/* ... rest unchanged ... */}
    </div>
  );
}
```

**Step 5: UnifiedView에서 stats prop 전달**

In `packages/ui/src/views/unified/UnifiedView.tsx`, update:

```tsx
const { agents, events, completedSessions, stats } = useWebSocket(WS_URL);
// ...
<RightPanel events={events} agents={agentList} completedSessions={completedSessions} stats={stats} />
```

**Step 6: Build and verify**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm build`
Expected: Build succeeds

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add packages/ui/src/views/dashboard/components/AgentStats.tsx packages/ui/src/views/unified/RightPanel.tsx packages/ui/src/views/unified/UnifiedView.tsx packages/ui/src/views/dashboard/hooks/useWebSocket.ts packages/i18n/src/locales/en.json packages/i18n/src/locales/ko.json
git commit -m "feat(ui): add AgentStats component to RightPanel"
```

---

## Phase 2: Token Usage Tracking

### Task 5: Transcript 파서 모듈 작성

**Files:**
- Create: `packages/core/src/transcript/parser.ts`
- Create: `packages/core/src/__tests__/transcriptParser.test.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/transcriptParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseTranscriptTokens } from '../transcript/parser.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP_DIR = join(tmpdir(), 'claude-alive-test-transcript');

function setup() {
  mkdirSync(TMP_DIR, { recursive: true });
}

function cleanup() {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

function writeJsonl(filename: string, lines: object[]): string {
  const path = join(TMP_DIR, filename);
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return path;
}

describe('parseTranscriptTokens', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('sums token usage from assistant entries', async () => {
    const path = writeJsonl('test.jsonl', [
      { type: 'user', message: { role: 'user', content: 'hello' } },
      {
        type: 'assistant',
        message: {
          id: 'msg_1', model: 'claude-opus-4-6', role: 'assistant',
          content: [{ type: 'text', text: 'hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 },
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_2', model: 'claude-opus-4-6', role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 80, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 400 },
        },
      },
    ]);

    const result = await parseTranscriptTokens(path);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(180);
    expect(result!.outputTokens).toBe(80);
    expect(result!.cacheCreationTokens).toBe(200);
    expect(result!.cacheReadTokens).toBe(700);
    expect(result!.totalTokens).toBe(1160);
    expect(result!.apiCalls).toBe(2);
    expect(result!.model).toBe('claude-opus-4-6');
  });

  it('deduplicates streaming chunks by message ID', async () => {
    const path = writeJsonl('stream.jsonl', [
      {
        type: 'assistant',
        message: {
          id: 'msg_1', model: 'claude-opus-4-6', role: 'assistant',
          content: [{ type: 'text', text: 'partial' }],
          stop_reason: null,
          usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_1', model: 'claude-opus-4-6', role: 'assistant',
          content: [{ type: 'text', text: 'full response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);

    const result = await parseTranscriptTokens(path);
    expect(result!.inputTokens).toBe(100);
    expect(result!.outputTokens).toBe(50);
    expect(result!.apiCalls).toBe(1);
  });

  it('returns null for nonexistent file', async () => {
    const result = await parseTranscriptTokens('/nonexistent/path.jsonl');
    expect(result).toBeNull();
  });

  it('returns null for empty file', async () => {
    const path = writeJsonl('empty.jsonl', []);
    writeFileSync(path, '');
    const result = await parseTranscriptTokens(path);
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm --filter=@claude-alive/core test`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `packages/core/src/transcript/parser.ts`:

```typescript
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  apiCalls: number;
  model: string;
}

interface TranscriptAssistantEntry {
  type: 'assistant';
  message: {
    id: string;
    model: string;
    stop_reason: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

export async function parseTranscriptTokens(filePath: string): Promise<TokenUsage | null> {
  const lastByMsgId = new Map<string, TranscriptAssistantEntry['message']>();

  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'assistant' || !entry.message?.id || !entry.message?.usage) continue;
        lastByMsgId.set(entry.message.id, entry.message);
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    return null;
  }

  if (lastByMsgId.size === 0) return null;

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let model = '';

  for (const msg of lastByMsgId.values()) {
    inputTokens += msg.usage.input_tokens ?? 0;
    outputTokens += msg.usage.output_tokens ?? 0;
    cacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0;
    cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
    if (msg.model) model = msg.model;
  }

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
    apiCalls: lastByMsgId.size,
    model,
  };
}
```

Export from `packages/core/src/index.ts`:

```typescript
export { parseTranscriptTokens } from './transcript/parser.js';
export type { TokenUsage } from './transcript/parser.js';
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm --filter=@claude-alive/core test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/core/src/transcript/parser.ts packages/core/src/__tests__/transcriptParser.test.ts packages/core/src/index.ts
git commit -m "feat(core): add transcript JSONL parser for token usage"
```

---

### Task 6: AgentInfo에 tokenUsage 필드 추가 + 서버 연동

**Files:**
- Modify: `packages/core/src/events/types.ts:60-83`
- Modify: `packages/server/src/index.ts:37-51`

**Step 1: AgentInfo에 tokenUsage 추가**

In `packages/core/src/events/types.ts`, import `TokenUsage` and add to `AgentInfo`:

```typescript
import type { TokenUsage } from './transcript/parser.js';

// Wait — circular dependency risk. TokenUsage is in core/transcript/parser.ts, types.ts is in core/events/types.ts.
// Better: define TokenUsage interface in types.ts to avoid circular deps.
```

Actually, define `TokenUsage` in `types.ts` and re-export from `parser.ts`:

In `packages/core/src/events/types.ts`, add after `AgentInfo`:

```typescript
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  apiCalls: number;
  model: string;
}
```

Add to `AgentInfo`:

```typescript
/** Token usage from transcript parsing (populated after session ends) */
tokenUsage: TokenUsage | null;
```

Update `packages/core/src/transcript/parser.ts` to import from types:

```typescript
import type { TokenUsage } from '../events/types.js';
export type { TokenUsage };
```

Update `packages/core/src/index.ts` to export `TokenUsage` from types:

```typescript
export type { TokenUsage } from './events/types.js';
```

**Step 2: sessionStore createAgent에 tokenUsage: null 추가**

In `packages/core/src/state/sessionStore.ts` `createAgent` method, add:

```typescript
tokenUsage: null,
```

**Step 3: 서버에서 세션 종료 시 transcript 파싱**

In `packages/server/src/index.ts`, import `parseTranscriptTokens`:

```typescript
import { SessionStore, parseTranscriptTokens } from '@claude-alive/core';
```

In `onEvent()`, inside the `SessionEnd` / `SubagentStop` block (lines 37-51), after the `agent:completed` broadcast, add async transcript parsing:

```typescript
// Async transcript parsing (non-blocking)
if (agent.transcriptPath) {
  parseTranscriptTokens(agent.transcriptPath).then((usage) => {
    if (usage) {
      const current = store.getAgent(agent.sessionId);
      if (current) {
        current.tokenUsage = usage;
      }
    }
  }).catch(() => {});
}
```

**Step 4: Build and verify**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add packages/core/src/events/types.ts packages/core/src/transcript/parser.ts packages/core/src/state/sessionStore.ts packages/core/src/index.ts packages/server/src/index.ts
git commit -m "feat: integrate transcript parsing into agent lifecycle"
```

---

### Task 7: UI에 토큰 사용량 표시

**Files:**
- Modify: `packages/ui/src/views/dashboard/components/AgentStats.tsx`
- Modify: `packages/ui/src/views/dashboard/components/CompletionLog.tsx`
- Modify: `packages/i18n/src/locales/en.json`
- Modify: `packages/i18n/src/locales/ko.json`

**Step 1: i18n 키 추가**

In `en.json`, add:

```json
"tokens": {
  "title": "Token Usage",
  "input": "Input",
  "output": "Output",
  "cacheCreation": "Cache Write",
  "cacheRead": "Cache Read",
  "total": "Total",
  "apiCalls": "API Calls",
  "model": "Model"
}
```

In `ko.json`, add:

```json
"tokens": {
  "title": "토큰 사용량",
  "input": "입력",
  "output": "출력",
  "cacheCreation": "캐시 쓰기",
  "cacheRead": "캐시 읽기",
  "total": "합계",
  "apiCalls": "API 호출",
  "model": "모델"
}
```

**Step 2: AgentStats에 총 토큰 표시 추가**

In `packages/ui/src/views/dashboard/components/AgentStats.tsx`, accept `agents` prop and compute aggregate tokens:

```tsx
interface AgentStatsProps {
  stats: AgentStatsType | null;
  agents: AgentInfo[];
}

export function AgentStats({ stats, agents }: AgentStatsProps) {
  const { t } = useTranslation();

  // ... existing code

  // Aggregate token usage across all agents
  const totalTokens = agents.reduce((sum, a) => {
    return sum + (a.tokenUsage?.totalTokens ?? 0);
  }, 0);

  // Add token section after top tools:
  {totalTokens > 0 && (
    <div>
      <div className="text-[11px] font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
        {t('tokens.title')}
      </div>
      <span className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        {totalTokens.toLocaleString()} {t('tokens.total')}
      </span>
    </div>
  )}
}
```

Update `RightPanel.tsx` to pass `agents` to `AgentStats`:
```tsx
<AgentStats stats={stats} agents={agentList} />
```

**Step 3: CompletionLog에 토큰 배지 표시**

In `packages/ui/src/views/dashboard/components/CompletionLog.tsx`, the `CompletedSession` type doesn't have tokenUsage. We need to look up token data from agents.

Better approach: add `tokenUsage` to `CompletedSession` in types.ts:

```typescript
export interface CompletedSession {
  // ... existing
  tokenUsage?: TokenUsage | null;
}
```

Update `sessionStore.ts` `addCompletedSession`:

```typescript
private addCompletedSession(agent: AgentInfo): void {
  this.completedSessions.push({
    sessionId: agent.sessionId,
    cwd: agent.cwd,
    projectName: agent.projectName,
    completedAt: Date.now(),
    lastPrompt: agent.lastPrompt,
    displayName: agent.displayName,
    tokenUsage: agent.tokenUsage,
  });
  // ... trim logic
}
```

In `CompletionLog.tsx`, after the time display, add token badge:

```tsx
{session.tokenUsage && (
  <span
    className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-medium"
    style={{ background: 'var(--accent-blue)15', color: 'var(--accent-blue)' }}
  >
    {session.tokenUsage.totalTokens.toLocaleString()} tok
  </span>
)}
```

**Step 4: Build and verify**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm build && pnpm test`
Expected: Build succeeds, tests pass

**Step 5: Commit**

```bash
git add packages/ui/src/views/dashboard/components/AgentStats.tsx packages/ui/src/views/dashboard/components/CompletionLog.tsx packages/ui/src/views/unified/RightPanel.tsx packages/core/src/events/types.ts packages/core/src/state/sessionStore.ts packages/i18n/src/locales/en.json packages/i18n/src/locales/ko.json
git commit -m "feat(ui): display token usage in stats and completion log"
```

---

## Phase 3: Embedded Terminal (xterm.js)

### Task 8: 서버에 PTY 매니저 추가

**Files:**
- Create: `packages/server/src/ptyManager.ts`
- Create: `packages/server/src/__tests__/ptyManager.test.ts`

**Step 1: Write the failing test**

Create `packages/server/src/__tests__/ptyManager.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { PtyManager } from '../ptyManager.js';

describe('PtyManager', () => {
  let manager: PtyManager;

  afterEach(() => {
    manager?.destroyAll();
  });

  it('creates a session', () => {
    manager = new PtyManager({ maxSessions: 5 });
    const session = manager.createSession('/tmp');
    expect(session).not.toBeNull();
    expect(session!.id).toBeTruthy();
  });

  it('enforces max sessions limit', () => {
    manager = new PtyManager({ maxSessions: 2 });
    manager.createSession('/tmp');
    manager.createSession('/tmp');
    const third = manager.createSession('/tmp');
    expect(third).toBeNull();
  });

  it('destroys a session', () => {
    manager = new PtyManager({ maxSessions: 5 });
    const session = manager.createSession('/tmp');
    expect(manager.destroySession(session!.id)).toBe(true);
    expect(manager.destroySession(session!.id)).toBe(false);
  });

  it('lists active sessions', () => {
    manager = new PtyManager({ maxSessions: 5 });
    manager.createSession('/tmp');
    manager.createSession('/tmp');
    expect(manager.listSessions().length).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm --filter=@claude-alive/server test`
Expected: FAIL — module not found

**Step 3: Install node-pty dependency**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm --filter=@claude-alive/server add node-pty`

**Step 4: Write minimal implementation**

Create `packages/server/src/ptyManager.ts`:

```typescript
import { spawn, type IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';

export interface PtySession {
  id: string;
  pty: IPty;
  createdAt: number;
}

export interface PtyManagerOptions {
  maxSessions: number;
  inactivityTimeoutMs?: number;
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();
  private maxSessions: number;
  private inactivityTimeoutMs: number;
  private inactivityTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: PtyManagerOptions) {
    this.maxSessions = options.maxSessions;
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? 30 * 60 * 1000;
  }

  createSession(cwd: string): PtySession | null {
    if (this.sessions.size >= this.maxSessions) return null;

    const id = randomUUID();
    const shell = process.env.SHELL || '/bin/zsh';
    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    });

    const session: PtySession = { id, pty, createdAt: Date.now() };
    this.sessions.set(id, session);
    this.resetInactivityTimer(id);
    return session;
  }

  writeInput(id: string, data: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.write(data);
    this.resetInactivityTimer(id);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.resize(cols, rows);
    return true;
  }

  onOutput(id: string, callback: (data: string) => void): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.onData(callback);
    return true;
  }

  onExit(id: string, callback: (exitCode: number) => void): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.clearInactivityTimer(id);
      callback(exitCode);
    });
    return true;
  }

  destroySession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.pty.kill();
    this.sessions.delete(id);
    this.clearInactivityTimer(id);
    return true;
  }

  listSessions(): { id: string; createdAt: number }[] {
    return Array.from(this.sessions.values()).map(s => ({ id: s.id, createdAt: s.createdAt }));
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroySession(id);
    }
  }

  private resetInactivityTimer(id: string): void {
    this.clearInactivityTimer(id);
    this.inactivityTimers.set(id, setTimeout(() => {
      this.destroySession(id);
    }, this.inactivityTimeoutMs));
  }

  private clearInactivityTimer(id: string): void {
    const timer = this.inactivityTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.inactivityTimers.delete(id);
    }
  }
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm --filter=@claude-alive/server test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add packages/server/src/ptyManager.ts packages/server/src/__tests__/ptyManager.test.ts packages/server/package.json pnpm-lock.yaml
git commit -m "feat(server): add PtyManager for terminal sessions"
```

---

### Task 9: 터미널용 WebSocket 엔드포인트 추가

**Files:**
- Modify: `packages/server/src/wsServer.ts`
- Modify: `packages/server/src/index.ts`

**Step 1: WSBroadcaster에 터미널 WS 경로 추가**

In `packages/server/src/wsServer.ts`, add a separate `WebSocketServer` for `/ws/terminal`:

```typescript
// Add new class or extend WSBroadcaster:
import { PtyManager } from './ptyManager.js';

export class TerminalWSServer {
  private wss: WebSocketServer;
  private ptyManager: PtyManager;

  constructor(server: Server, ptyManager: PtyManager) {
    this.ptyManager = ptyManager;
    this.wss = new WebSocketServer({ server, path: '/ws/terminal' });

    this.wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(ws, msg);
        } catch { /* ignore */ }
      });
    });
  }

  private handleMessage(ws: WebSocket, msg: any): void {
    switch (msg.type) {
      case 'terminal:create': {
        const session = this.ptyManager.createSession(msg.cwd || process.env.HOME || '/');
        if (!session) {
          ws.send(JSON.stringify({ type: 'terminal:error', error: 'Max sessions reached' }));
          return;
        }
        this.ptyManager.onOutput(session.id, (data) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'terminal:output', sessionId: session.id, data }));
          }
        });
        this.ptyManager.onExit(session.id, (exitCode) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'terminal:exited', sessionId: session.id, exitCode }));
          }
        });
        ws.send(JSON.stringify({ type: 'terminal:created', sessionId: session.id }));
        break;
      }
      case 'terminal:input': {
        this.ptyManager.writeInput(msg.sessionId, msg.data);
        break;
      }
      case 'terminal:resize': {
        this.ptyManager.resize(msg.sessionId, msg.cols, msg.rows);
        break;
      }
      case 'terminal:destroy': {
        this.ptyManager.destroySession(msg.sessionId);
        break;
      }
    }
  }

  close(): void {
    this.ptyManager.destroyAll();
    this.wss.close();
  }
}
```

**Step 2: server/index.ts에 TerminalWSServer 연결**

In `packages/server/src/index.ts`:

```typescript
import { PtyManager } from './ptyManager.js';
import { TerminalWSServer } from './wsServer.js';

const ptyManager = new PtyManager({ maxSessions: 5 });
// After httpServer creation:
const terminalWs = new TerminalWSServer(httpServer, ptyManager);

// In SIGINT handler:
terminalWs.close();
```

**Step 3: Build and verify**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/server/src/wsServer.ts packages/server/src/index.ts
git commit -m "feat(server): add terminal WebSocket endpoint /ws/terminal"
```

---

### Task 10: UI에 xterm.js 터미널 패널 추가

**Files:**
- Create: `packages/ui/src/views/terminal/TerminalPanel.tsx`
- Create: `packages/ui/src/views/terminal/useTerminalWS.ts`
- Modify: `packages/ui/src/views/unified/UnifiedView.tsx`
- Modify: `packages/i18n/src/locales/en.json`
- Modify: `packages/i18n/src/locales/ko.json`

**Step 1: Install xterm dependencies**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm --filter=@claude-alive/ui add @xterm/xterm @xterm/addon-fit @xterm/addon-web-links`

**Step 2: i18n 키 추가**

In `en.json`:
```json
"terminal": {
  "title": "Terminal",
  "newTab": "New",
  "close": "Close",
  "maxSessions": "Max sessions reached"
}
```

In `ko.json`:
```json
"terminal": {
  "title": "터미널",
  "newTab": "새 탭",
  "close": "닫기",
  "maxSessions": "최대 세션 수 초과"
}
```

**Step 3: useTerminalWS hook 작성**

Create `packages/ui/src/views/terminal/useTerminalWS.ts`:

```typescript
import { useRef, useCallback, useEffect } from 'react';

const WS_URL = `ws://${window.location.hostname}:${window.location.port || '3141'}/ws/terminal`;

interface TerminalWSCallbacks {
  onCreated: (sessionId: string) => void;
  onOutput: (sessionId: string, data: string) => void;
  onExited: (sessionId: string, exitCode: number) => void;
}

export function useTerminalWS(callbacks: TerminalWSCallbacks) {
  const wsRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'terminal:created':
          callbacksRef.current.onCreated(msg.sessionId);
          break;
        case 'terminal:output':
          callbacksRef.current.onOutput(msg.sessionId, msg.data);
          break;
        case 'terminal:exited':
          callbacksRef.current.onExited(msg.sessionId, msg.exitCode);
          break;
      }
    };

    return () => ws.close();
  }, []);

  const createSession = useCallback((cwd?: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'terminal:create', cwd }));
  }, []);

  const sendInput = useCallback((sessionId: string, data: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'terminal:input', sessionId, data }));
  }, []);

  const resize = useCallback((sessionId: string, cols: number, rows: number) => {
    wsRef.current?.send(JSON.stringify({ type: 'terminal:resize', sessionId, cols, rows }));
  }, []);

  const destroySession = useCallback((sessionId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'terminal:destroy', sessionId }));
  }, []);

  return { createSession, sendInput, resize, destroySession };
}
```

**Step 4: TerminalPanel 컴포넌트 작성**

Create `packages/ui/src/views/terminal/TerminalPanel.tsx`:

```tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTerminalWS } from './useTerminalWS.ts';

interface TerminalTab {
  id: string;
  sessionId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
}

interface TerminalPanelProps {
  open: boolean;
  onToggle: () => void;
  height: number;
  onHeightChange: (h: number) => void;
}

export function TerminalPanel({ open, onToggle, height, onHeightChange }: TerminalPanelProps) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const pendingTerminals = useRef(new Map<string, Terminal>());

  const ws = useTerminalWS({
    onCreated: (sessionId) => {
      const terminal = pendingTerminals.current.get('pending');
      if (!terminal) return;
      pendingTerminals.current.delete('pending');

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      const tabId = sessionId;
      const tab: TerminalTab = { id: tabId, sessionId, terminal, fitAddon };
      setTabs(prev => [...prev, tab]);
      setActiveTab(tabId);

      // Render after state update
      requestAnimationFrame(() => {
        const el = document.getElementById(`terminal-${tabId}`);
        if (el) {
          terminal.open(el);
          fitAddon.fit();
          ws.resize(sessionId, terminal.cols, terminal.rows);
        }
      });

      terminal.onData((data) => ws.sendInput(sessionId, data));
      terminal.onResize(({ cols, rows }) => ws.resize(sessionId, cols, rows));
    },
    onOutput: (sessionId, data) => {
      const tab = tabs.find(t => t.sessionId === sessionId);
      tab?.terminal.write(data);
    },
    onExited: (sessionId) => {
      setTabs(prev => prev.filter(t => t.sessionId !== sessionId));
    },
  });

  const createTab = useCallback(() => {
    const terminal = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#f0f6fc',
        cursor: '#58a6ff',
      },
      fontFamily: 'SF Mono, Fira Code, JetBrains Mono, monospace',
      fontSize: 13,
    });
    pendingTerminals.current.set('pending', terminal);
    ws.createSession();
  }, [ws]);

  const closeTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      tab.terminal.dispose();
      ws.destroySession(tab.sessionId);
      setTabs(prev => prev.filter(t => t.id !== tabId));
      if (activeTab === tabId) {
        setActiveTab(tabs[0]?.id ?? null);
      }
    }
  }, [tabs, activeTab, ws]);

  // Drag to resize
  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startY: e.clientY, startH: height };
    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - me.clientY;
      const newH = Math.max(150, Math.min(window.innerHeight * 0.6, dragRef.current.startH + delta));
      onHeightChange(newH);
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Refit terminals
      tabs.forEach(tab => tab.fitAddon.fit());
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [height, onHeightChange, tabs]);

  // Auto-create first tab when opened
  useEffect(() => {
    if (open && tabs.length === 0) {
      createTab();
    }
  }, [open]);

  if (!open) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-4 right-4 px-4 py-2 rounded-lg text-[13px] font-medium z-50"
        style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
      >
        {t('terminal.title')}
      </button>
    );
  }

  return (
    <div
      style={{ height, background: 'var(--bg-primary)', borderTop: '1px solid var(--border-color)' }}
      className="flex flex-col"
    >
      {/* Drag handle */}
      <div
        className="h-1 cursor-row-resize hover:bg-blue-500/30 transition-colors"
        onMouseDown={onDragStart}
      />

      {/* Tab bar */}
      <div
        className="flex items-center gap-1 px-3 py-1.5 shrink-0"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}
      >
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px]"
            style={{
              background: activeTab === tab.id ? 'var(--bg-card)' : 'transparent',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {t('terminal.title')}
            <span
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="ml-1 hover:text-red-400 cursor-pointer"
            >
              x
            </span>
          </button>
        ))}
        <button
          onClick={createTab}
          className="px-2 py-1 rounded-md text-[12px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          + {t('terminal.newTab')}
        </button>
        <div className="flex-1" />
        <button
          onClick={onToggle}
          className="px-2 py-1 text-[11px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          {t('terminal.close')}
        </button>
      </div>

      {/* Terminal container */}
      <div ref={containerRef} className="flex-1 relative">
        {tabs.map(tab => (
          <div
            key={tab.id}
            id={`terminal-${tab.id}`}
            className="absolute inset-0 p-2"
            style={{ display: activeTab === tab.id ? 'block' : 'none' }}
          />
        ))}
      </div>
    </div>
  );
}
```

**Step 5: UnifiedView에 TerminalPanel 통합**

In `packages/ui/src/views/unified/UnifiedView.tsx`:

```tsx
import { useState } from 'react';
import { TerminalPanel } from '../terminal/TerminalPanel.tsx';

export function UnifiedView() {
  // ... existing code
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(300);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Main content area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <ProjectSidebar agents={agentList} onRename={handleRename} />
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          {/* ... existing center content ... */}
        </div>
        <RightPanel events={events} agents={agentList} completedSessions={completedSessions} stats={stats} />
      </div>

      {/* Terminal panel */}
      <TerminalPanel
        open={terminalOpen}
        onToggle={() => setTerminalOpen(prev => !prev)}
        height={terminalHeight}
        onHeightChange={setTerminalHeight}
      />
    </div>
  );
}
```

**Step 6: Build and verify**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm build`
Expected: Build succeeds

**Step 7: Manual test**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm dev`
- Open http://localhost:5173
- Click "Terminal" button at bottom-right
- Terminal panel should appear with a shell prompt
- Type `claude -p "hello"` to test Claude CLI integration
- Drag the top edge to resize
- Click "x" to close a tab, "+" to add a new one

**Step 8: Commit**

```bash
git add packages/ui/src/views/terminal/ packages/ui/src/views/unified/UnifiedView.tsx packages/ui/package.json packages/i18n/src/locales/en.json packages/i18n/src/locales/ko.json pnpm-lock.yaml
git commit -m "feat(ui): add embedded xterm.js terminal panel"
```

---

### Task 11: 전체 빌드 + 테스트 + 타입 체크

**Files:** None (verification only)

**Step 1: Full build**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm build`
Expected: All packages build successfully

**Step 2: Run all tests**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm test`
Expected: All tests pass

**Step 3: Type check UI**

Run: `cd /Users/mufin/Documents/claude-management/claude-ui/claude-alive && pnpm --filter=@claude-alive/ui exec tsc --noEmit`
Expected: No type errors

**Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore: fix build issues from dashboard enhancements"
```

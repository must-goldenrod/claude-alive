# Dashboard Enhancements Design

**Date:** 2026-03-04
**Status:** Approved
**Version:** claude-alive 0.2.3 → 0.3.0

## Overview

claude-alive 대시보드에 3가지 기능을 점진적으로 추가한다.

| Phase | Feature | Complexity |
|-------|---------|------------|
| 1 | Agent call statistics | Low |
| 2 | Token usage tracking (transcript parsing) | Medium |
| 3 | Embedded terminal (xterm.js) | High |

---

## Phase 1: Agent Call Statistics

### Goal
사용자가 어떤 에이전트(서브에이전트)를 얼마나 호출했는지 실시간으로 확인.

### Data Model Changes

```typescript
// core/events/types.ts — AgentInfo 확장
interface AgentInfo {
  // ... existing fields
  toolCallCount: number;  // total tool calls for this agent
}

// core/state/sessionStore.ts — 새 집계
interface AgentStats {
  totalAgents: number;
  activeAgents: number;
  subagentsByType: Record<string, number>;
  toolCallsByName: Record<string, number>;
}
```

### Server Changes
- `SessionStore.getStats(): AgentStats` method
- `GET /api/stats` endpoint
- WebSocket `snapshot` message includes `stats`
- New WS message: `stats:update` (broadcast on each event)

### UI Component
- `AgentStats.tsx` in RightPanel, above ActivityPulse
- Compact card showing:
  - Active / total agent count
  - Subagent type breakdown (bar or list)
  - Top 5 tool calls

### i18n Keys
- `stats.title`, `stats.activeAgents`, `stats.totalAgents`
- `stats.subagentTypes`, `stats.topTools`

---

## Phase 2: Token Usage Tracking

### Goal
에이전트 종료 시 transcript 파일을 파싱하여 토큰 사용량 표시.

### Transcript File Format
- Location: `~/.claude/projects/<path>/<session>.jsonl`
- Subagents: `<session>/subagents/agent-<hash>.jsonl`
- Token data: `assistant` type entries → `message.usage`
- Dedup: group by `message.id`, take last entry (streaming chunks)

### Token Usage Schema

```typescript
// core/transcript/parser.ts
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  apiCalls: number;
  model: string;
}
```

### Parsing Algorithm
1. `fs.createReadStream` + `readline` (streaming, non-blocking)
2. Filter `type === "assistant"`
3. Group by `message.id`, keep last entry per ID
4. Sum usage fields
5. Return `TokenUsage` object

### Server Changes
- On `SubagentStop` / `SessionEnd`: async parse `transcriptPath`
- Store result in `AgentInfo.tokenUsage: TokenUsage | null`
- Include in WS `agent:completed` message
- Graceful fallback on parse failure (null + log warning)

### UI Display
- `AgentStats.tsx`: aggregate token totals across all agents
- `CompletionLog`: per-session token count badge
- `AgentTimelinePanel`: detailed token breakdown

### i18n Keys
- `tokens.title`, `tokens.input`, `tokens.output`
- `tokens.cacheCreation`, `tokens.cacheRead`, `tokens.total`
- `tokens.apiCalls`, `tokens.model`

---

## Phase 3: Embedded Terminal (xterm.js)

### Goal
대시보드 하단에 토글 가능한 터미널 패널을 내장하여 Claude CLI를 직접 실행.

### Architecture

```
xterm.js (browser) ←→ WebSocket ←→ node-pty (server) ←→ shell
```

### Server: PTY Manager

```typescript
// server/src/ptyManager.ts
interface PtySession {
  id: string;
  pty: IPty;
  createdAt: number;
}

// Features:
// - createSession(cwd): PtySession
// - writeInput(id, data)
// - onOutput(id, callback)
// - destroySession(id)
// - listSessions()

// Limits:
// - Max 5 concurrent sessions
// - 30-minute inactivity timeout
```

### WebSocket Protocol

Separate WS path: `ws://localhost:3141/ws/terminal`

```typescript
// Client → Server
{ type: 'terminal:create', cwd: string }
{ type: 'terminal:input', sessionId: string, data: string }
{ type: 'terminal:resize', sessionId: string, cols: number, rows: number }
{ type: 'terminal:destroy', sessionId: string }

// Server → Client
{ type: 'terminal:created', sessionId: string }
{ type: 'terminal:output', sessionId: string, data: string }
{ type: 'terminal:exited', sessionId: string, exitCode: number }
```

### UI Layout

```
┌──────────────────────────────────────┐
│ Header                               │
├────┬─────────────────────┬───────────┤
│Side│  Pixel Office       │Right Panel│
│bar │                     │           │
│    │                     │           │
├────┴─────────────────────┴───────────┤
│ ▼ Terminal (toggle, drag-resizable)  │
│ $ claude -p "prompt"                 │
└──────────────────────────────────────┘
```

### UI Component

```typescript
// ui/src/views/terminal/TerminalPanel.tsx
// - Toggle button in header or floating
// - Drag handle for height resize (min: 150px, max: 60vh)
// - xterm.js + @xterm/addon-fit
// - Multi-tab support (multiple sessions)
// - Close/minimize buttons
```

### Dependencies

```
Server: node-pty (native module, prebuild-install)
UI: @xterm/xterm, @xterm/addon-fit, @xterm/addon-web-links
```

### Security
- Localhost-only (existing CORS policy)
- No auth needed (same as existing WS)
- Session count limit (5)
- Inactivity timeout (30min)

### Layout Integration
- `UnifiedView.tsx`: wrap in flex-col
- Top: existing 3-column layout (flex-1)
- Bottom: TerminalPanel (conditional, resizable)

---

## Release Plan

| Version | Phase | Scope |
|---------|-------|-------|
| 0.3.0 | Phase 1 | Agent stats UI |
| 0.4.0 | Phase 2 | Token tracking |
| 0.5.0 | Phase 3 | Embedded terminal |

Each phase is independently releasable and backward-compatible.

# claude-alive

Real-time animated UI for Claude Code sessions, powered by [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks).

Every Claude Code lifecycle event (tool use, permission request, session start/stop, sub-agent spawn, etc.) is captured by hooks and streamed to a local server, which broadcasts them to a web UI via WebSocket.

## Views

| Dashboard | 3D Field | Pixel Office |
|-----------|----------|--------------|
| Stats, project groups, agent cards, live event stream | Dashboard panel + Three.js battlefield with animated agent models | Dashboard panel + pixel art office with walking characters |

All views update in real-time, share a single WebSocket, and support Korean/English (click the language toggle).

## Quick Start

```bash
# All commands must be run from the project root
cd claude-alive

# 1. Install dependencies and build
pnpm install
pnpm build

# 2. Install hooks into Claude Code settings
node packages/cli/dist/index.js install

# 3. Start the server
node packages/server/dist/index.js
```

Open http://localhost:3141 — any running Claude Code session will appear automatically.

## How It Works

```
Claude Code Session
  ↓ hook event (stdin JSON)
~/.claude-alive/hooks/stream-event.sh
  ↓ HTTP POST
localhost:3141/api/events
  ↓ SessionStore + FSM
WebSocket broadcast
  ↓
React UI (Dashboard / 3D / Pixel)
```

1. **Hooks** — Shell scripts registered in `~/.claude/settings.json` that fire on 13 lifecycle events
2. **Server** — HTTP receiver + WebSocket broadcaster on port 3141, serves the UI as static files
3. **Core** — Agent FSM (state machine), event types, session store, tool→animation mapper
4. **UI** — Three views with a shared tab bar, lazy-loaded Three.js, resizable split panels

## Packages

| Package | Description |
|---------|-------------|
| `@claude-alive/core` | Agent types, FSM, session store, WS protocol |
| `@claude-alive/server` | HTTP + WebSocket server, serves built UI |
| `@claude-alive/hooks` | Hook installer (writes to `~/.claude/settings.json`) |
| `@claude-alive/cli` | CLI: `install`, `uninstall`, `start`, `status` |
| `@claude-alive/i18n` | Korean/English translations (react-i18next) |
| `@claude-alive/ui` | Unified web app (Dashboard + 3D + Pixel views) |

## CLI

```bash
claude-alive install     # Install hooks into ~/.claude/settings.json
claude-alive uninstall   # Remove hooks
claude-alive start       # Start the server
claude-alive status      # Check if server is running
```

## Agent States

```
spawning → listening → active → idle
                ↓         ↓
             waiting    error → active
                ↓
              done → despawning → removed
```

Transitions are driven by hook events: `PreToolUse` → active, `PermissionRequest` → waiting, `Stop` → idle, `SessionEnd` → despawning.

## Tech Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Backend**: Node.js, `ws` library, zero frameworks
- **Frontend**: React, Vite, Tailwind CSS, react-i18next
- **3D**: Three.js via `@react-three/fiber` + `@react-three/drei`
- **Pixel Engine**: Custom 2D canvas with BFS pathfinding, sprite system, matrix effects

## License

MIT

# claude-alive

Real-time animated UI for Claude Code sessions, powered by [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks).

Every Claude Code lifecycle event (tool use, permission request, session start/stop, sub-agent spawn, etc.) is captured by hooks and streamed to a local server, which broadcasts them to a web UI via WebSocket.

## View

Live2D (Bishoujo) characters represent your Claude Code agents in real-time. Each agent's state — coding, reading, waiting for permission, encountering errors — is reflected through character animations and speech bubbles.

All updates are real-time via WebSocket. Supports Korean/English (click the language toggle).

## Quick Start

```bash
# All commands must be run from the project root
cd claude-alive

# 1. Install dependencies and build
pnpm install
pnpm build

# 2. (Optional) Download Live2D models
bash scripts/setup-live2d.sh

# 3. Install hooks into Claude Code settings
node packages/cli/dist/index.js install

# 4. Start the server
node packages/server/dist/index.js
```

Open http://localhost:3141 — any running Claude Code session will appear automatically.

## How It Works

```
Claude Code Session
  ↓ hook event (stdin JSON)
~/.claude-alive/hooks/stream-event.sh
  ↓ HTTP POST
localhost:3141/api/event
  ↓ SessionStore + FSM
WebSocket broadcast
  ↓
React UI (Live2D Bishoujo View)
```

1. **Hooks** — Shell scripts registered in `~/.claude/settings.json` that fire on lifecycle events
2. **Server** — HTTP receiver + WebSocket broadcaster on port 3141, serves the UI as static files
3. **Core** — Agent FSM (state machine), event types, session store, tool→animation mapper
4. **UI** — Live2D character view with project sidebar, activity panel, and notification overlay

## Packages

| Package | Description |
|---------|-------------|
| `@claude-alive/core` | Agent types, FSM, session store, WS protocol |
| `@claude-alive/server` | HTTP + WebSocket server, serves built UI |
| `@claude-alive/hooks` | Hook installer (writes to `~/.claude/settings.json`) |
| `@claude-alive/cli` | CLI: `install`, `uninstall`, `start`, `status` |
| `@claude-alive/i18n` | Korean/English translations (react-i18next) |
| `@claude-alive/ui` | Live2D web app with real-time agent visualization |

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

## Live2D Setup

Live2D Cubism SDK Core and sample models are proprietary and cannot be bundled. Run `bash scripts/setup-live2d.sh` to download them. By running this script you agree to the [Live2D license agreements](https://www.live2d.com/en/sdk/about/).

## Tech Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Backend**: Node.js, `ws` library, zero frameworks
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, react-i18next
- **Live2D**: PixiJS v8 + pixi-live2d-display

## License

MIT

<p align="center">
  <h1 align="center">claude-alive</h1>
  <p align="center">
    Real-time pixel office dashboard for Claude Code sessions<br/>
    Claude Code 세션을 실시간 픽셀 오피스로 시각화하는 대시보드
  </p>
</p>

<p align="center">
  <a href="#quick-start--빠른-시작">Quick Start</a> •
  <a href="#how-it-works--작동-원리">How It Works</a> •
  <a href="#features--주요-기능">Features</a> •
  <a href="#architecture--아키텍처">Architecture</a> •
  <a href="#development--개발">Development</a> •
  <a href="#license--라이선스">License</a>
</p>

---

## What is claude-alive? / claude-alive란?

**EN**

claude-alive is an open-source monitoring dashboard that brings your Claude Code sessions to life as a pixel art office. When Claude Code runs — writing code, reading files, running tests, spawning sub-agents — you normally only see text scrolling in a terminal. claude-alive captures every one of those lifecycle events through [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) and transforms them into animated pixel characters in a virtual office.

Each agent gets a pixel character that walks around, sits at desks, types on keyboards, and shows speech bubbles with the current tool being used. Sub-agents appear as smaller characters. An org chart overlay lets you see the full agent hierarchy at a glance.

Everything runs locally — no data leaves your machine.

**KO**

claude-alive는 Claude Code 세션을 픽셀아트 오피스로 실시간 시각화하는 오픈소스 모니터링 대시보드입니다. Claude Code가 코드를 작성하고, 파일을 읽고, 테스트를 실행하고, 서브에이전트를 생성할 때 — [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)를 통해 모든 라이프사이클 이벤트를 캡처하고 이를 가상 오피스의 픽셀 캐릭터 애니메이션으로 변환합니다.

각 에이전트는 픽셀 캐릭터로 표현되어 오피스를 돌아다니고, 책상에 앉아 타이핑하고, 말풍선으로 현재 사용 중인 도구를 표시합니다. 서브에이전트는 작은 크기의 캐릭터로 나타납니다. 조직도 오버레이로 에이전트 계층을 한눈에 볼 수 있습니다.

모든 데이터는 로컬에서만 처리됩니다.

---

## Quick Start / 빠른 시작

### Prerequisites / 필수 조건

- **Node.js** ≥ 20
- **pnpm** (install: `npm install -g pnpm`)
- **Claude Code** installed and working

### Option A: npm install (recommended / 권장)

```bash
# Install globally / 전역 설치
npm install -g claude-alive

# Register hooks with Claude Code / 훅 등록
claude-alive install

# Start the dashboard / 대시보드 시작
claude-alive start
```

Open **http://localhost:3141** — any running Claude Code session will appear automatically.

http://localhost:3141 을 열면 실행 중인 Claude Code 세션이 자동으로 나타납니다.

### Option B: From source / 소스에서 빌드

```bash
# 1. Clone / 클론
git clone https://github.com/hoyoungyang0526/claude-alive.git
cd claude-alive

# 2. Install dependencies / 의존성 설치
pnpm install

# 3. Build all packages / 전체 빌드
pnpm build

# 4. Register hooks / 훅 등록
node packages/cli/dist/index.js install

# 5. Start the server / 서버 시작
node packages/server/dist/index.js
```

Open **http://localhost:3141** and navigate to the **Pixel Office** tab (`#pixel`).

http://localhost:3141 을 열고 **Pixel Office** 탭 (`#pixel`)으로 이동하세요.

### Verify it works / 동작 확인

```bash
# In another terminal, check server status / 다른 터미널에서 서버 상태 확인
claude-alive status
# → {"agents":[],"uptime":...}

# Start a Claude Code session anywhere / 아무 데서나 Claude Code 시작
claude
# → The pixel office should show a new character spawning
# → 픽셀 오피스에 새 캐릭터가 나타나야 합니다
```

### Uninstall / 제거

```bash
# Remove hooks from Claude Code settings / 훅 제거
claude-alive uninstall

# Uninstall globally / 전역 제거
npm uninstall -g claude-alive
```

### CLI Commands / CLI 명령어

| Command | Description | 설명 |
|---------|-------------|------|
| `claude-alive install` | Register hooks in `~/.claude/settings.json` | 훅을 Claude Code 설정에 등록 |
| `claude-alive uninstall` | Remove hooks from settings | 훅 제거 |
| `claude-alive start` | Start the server on port 3141 | 서버 시작 (포트 3141) |
| `claude-alive status` | Check if server is running | 서버 상태 확인 |

**Environment variables / 환경 변수:**

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_ALIVE_PORT` | `3141` | Server port / 서버 포트 |

---

## How It Works / 작동 원리

```
Claude Code Session
  ↓ hook event (stdin JSON)
~/.claude-alive/hooks/stream-event.sh
  ↓ HTTP POST
localhost:3141/api/event
  ↓ SessionStore + FSM
WebSocket broadcast
  ↓
React UI (Pixel Office / Dashboard)
```

**EN**

1. **Hooks** — `claude-alive install` copies `stream-event.sh` to `~/.claude-alive/hooks/` and registers it in `~/.claude/settings.json` for all lifecycle events. Claude Code calls this script on every event, passing JSON on stdin.

2. **stream-event.sh** — Reads JSON from stdin and POSTs it to `localhost:3141/api/event`. Runs async with a 5-second timeout so it never blocks Claude Code.

3. **Server** — A lightweight Node.js HTTP + WebSocket server receives events, updates the session store (tracking all agents and states via an FSM), and broadcasts changes to all connected clients.

4. **UI** — A React app connects via WebSocket and renders two views:
   - **Dashboard** — 3-column layout with project sidebar, activity pulse, and event stream
   - **Pixel Office** — Canvas 2D pixel art office where agents are animated characters

**KO**

1. **훅** — `claude-alive install`이 `stream-event.sh`를 `~/.claude-alive/hooks/`에 복사하고 `~/.claude/settings.json`에 등록합니다. Claude Code는 모든 라이프사이클 이벤트마다 이 스크립트를 호출하며 stdin으로 JSON을 전달합니다.

2. **stream-event.sh** — stdin에서 JSON을 읽어 `localhost:3141/api/event`로 POST합니다. 비동기 실행, 5초 타임아웃으로 Claude Code를 차단하지 않습니다.

3. **서버** — Node.js HTTP + WebSocket 서버가 이벤트를 수신하고, 세션 스토어(FSM으로 에이전트 상태 추적)를 업데이트하고, 모든 클라이언트에 브로드캐스트합니다.

4. **UI** — React 앱이 WebSocket으로 연결되어 두 가지 뷰를 렌더링합니다:
   - **Dashboard** — 프로젝트 사이드바, 활동 펄스, 이벤트 스트림의 3컬럼 레이아웃
   - **Pixel Office** — Canvas 2D 픽셀아트 오피스에서 에이전트가 캐릭터로 움직임

### Agent State Machine / 에이전트 상태 머신

```
spawning → listening → active → idle
                ↓         ↓
             waiting    error → active
                ↓
              done → despawning → removed
```

### Supported Hook Events / 지원하는 훅 이벤트

| Event | Triggers |
|-------|----------|
| `SessionStart` / `SessionEnd` | Agent spawn / despawn |
| `PreToolUse` / `PostToolUse` | Active state + tool animation |
| `PostToolUseFailure` | Error state |
| `PermissionRequest` | Waiting state |
| `SubagentStart` / `SubagentStop` | Sub-agent spawn / despawn |
| `UserPromptSubmit` | Character faces user |
| `Stop` | Return to idle |
| `Notification`, `TaskCompleted`, `PreCompact` | Event log |

---

## Features / 주요 기능

### Pixel Office / 픽셀 오피스

**EN:** A 40×24 tile pixel art office with 4 zones (3 work areas + 1 break room). Each agent is a pixel character with 6 color palettes. Characters walk via BFS pathfinding, sit at desks, and show typing/reading animations based on the current tool.

**KO:** 40×24 타일의 픽셀아트 오피스, 4개 존(작업 영역 3개 + 휴게실 1개). 6가지 색상 팔레트의 픽셀 캐릭터. BFS 길찾기로 이동하고, 책상에 앉아 현재 도구에 따라 타이핑/읽기 애니메이션을 표시합니다.

**Office features / 오피스 기능:**
- Desks with monitors, chairs, bookshelves, plants
- Break room with sofa, coffee machine, snack machine, meeting table
- Whiteboards, posters, wall clocks
- Corridors with doors connecting zones

### Agent Hierarchy / 에이전트 계층

**EN:** Toggleable org chart overlay shows parent↔child agent relationships as a tree. Click any node to pan the camera to that character. Nodes show mini character sprites, name, and live status.

**KO:** 토글 가능한 조직도 오버레이가 부모↔자식 에이전트 관계를 트리로 표시합니다. 노드를 클릭하면 해당 캐릭터로 카메라가 이동합니다. 미니 스프라이트, 이름, 실시간 상태를 표시합니다.

### Real-time State Mapping / 실시간 상태 매핑

| Agent State | Character Behavior | 캐릭터 반응 |
|-------------|-------------------|-----------|
| Writing code | Typing animation at desk | 책상에서 타이핑 |
| Reading files | Reading animation | 읽기 애니메이션 |
| Waiting for permission | Yellow bubble "..." | 노란 말풍선 "..." |
| Error | Red bubble "!" | 빨간 말풍선 "!" |
| Idle | Wanders around office | 오피스 돌아다님 |
| Sub-agent spawned | Smaller character appears with matrix effect | 작은 캐릭터 + 매트릭스 이펙트 |

### Multi-Agent & Sub-Agent / 멀티에이전트

**EN:** Sub-agents appear as 75% scale characters. Each gets assigned to the same zone as their parent project. Speech bubbles show the current tool name (e.g., "Read", "Bash", "Edit").

**KO:** 서브에이전트는 75% 크기 캐릭터로 표시. 부모 프로젝트와 같은 존에 배정. 말풍선에 현재 도구명 표시 (예: "Read", "Bash", "Edit").

### Dashboard View / 대시보드 뷰

**EN:** Traditional monitoring view with project sidebar (groups agents by working directory), activity pulse, and chronological event stream.

**KO:** 프로젝트 사이드바(작업 디렉토리별 에이전트 그룹), 활동 펄스, 시간순 이벤트 스트림의 전통적 모니터링 뷰.

### Camera Controls / 카메라 조작

| Action | Control |
|--------|---------|
| Pan | Left-click drag |
| Zoom | Mouse wheel (0.25 step, range 0.5–8x) |
| Click character | Show tooltip |

---

## Architecture / 아키텍처

### Project Structure / 프로젝트 구조

```
claude-alive/
├── packages/
│   ├── core/       # Agent types, FSM, session store, WS protocol
│   ├── server/     # HTTP + WebSocket server (port 3141)
│   ├── hooks/      # Hook installer + stream-event.sh
│   ├── cli/        # CLI: install / uninstall / start / status
│   ├── i18n/       # EN/KO translations (i18next)
│   └── ui/         # React + Canvas 2D pixel office
│       └── src/views/
│           ├── pixel/          # Pixel Office view
│           │   ├── engine/     # Tilemap, renderer, camera, characters, pathfinding
│           │   ├── components/ # PixelCanvas, OrgChart overlay
│           │   └── utils/      # Agent tree builder, sprite caching
│           ├── dashboard/      # Dashboard components + hooks
│           └── unified/        # Shared sidebar, right panel
├── npm/            # esbuild entry points for npm package
└── scripts/        # Build & setup scripts
```

### Tech Stack / 기술 스택

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces + Turborepo |
| Backend | Node.js, `ws` WebSocket library |
| Frontend | React 19, Vite 6, Tailwind CSS 4 |
| Pixel Engine | Canvas 2D API (no external game libs) |
| i18n | i18next + react-i18next (EN/KO) |
| Bundling | esbuild (npm package), Vite (UI dev) |

### UI Layout / UI 레이아웃

**Pixel Office:**

```
┌──────────────┬──────────────────────────┬───────────────┐
│              │  [⊞] Org Chart Toggle    │               │
│  Project     │                          │  Activity     │
│  Sidebar     │    Pixel Office Canvas   │  Pulse        │
│  (280px)     │                          │               │
│              │  ┌─Zone A──┬─Zone B──┐   │  Event        │
│  - Project A │  │ 🧑‍💻 🧑‍💻  │ 🧑‍💻 🧑‍💻  │   │  Stream       │
│    - agent1  │  ├─Zone C──┼─Break───┤   │               │
│  - Project B │  │ 🧑‍💻 🧑‍💻  │ ☕ 🛋   │   │  - ToolUse    │
│    - agent2  │  └─────────┴─────────┘   │  - Spawn      │
│              │                          │  - Error      │
└──────────────┴──────────────────────────┴───────────────┘
```

### Security / 보안

- All HTTP endpoints only accept `localhost` requests (CORS restricted)
- Path traversal protection on static file serving
- Request body size limited to 1MB
- No external network calls — everything runs locally

---

## Development / 개발

### Setup / 설정

```bash
git clone https://github.com/hoyoungyang0526/claude-alive.git
cd claude-alive
pnpm install
```

### Commands / 명령어

```bash
# Build all packages (respects dependency order via Turborepo)
pnpm build

# Dev mode with hot reload (builds first, then watches)
pnpm dev

# Type check UI package
pnpm --filter=@claude-alive/ui exec tsc --noEmit

# Build npm distributable
bash scripts/build-npm.sh
```

### Package Dependency Graph / 패키지 의존 관계

```
core ← server ← cli
  ↑       ↑
  └── ui ──┘
       ↑
      i18n
hooks (standalone, no runtime deps)
```

- `core` — shared types, FSM, session store, WS protocol
- `server` — depends on `core`, serves `ui` build output as static files
- `cli` — depends on `hooks`, spawns `server` process
- `ui` — depends on `core` and `i18n`
- `hooks` — standalone, generates `stream-event.sh`

### Running from source (dev mode) / 소스에서 개발 모드 실행

```bash
# Terminal 1: Build and start the server
pnpm build
node packages/server/dist/index.js

# Terminal 2: Start the UI dev server (hot reload)
pnpm --filter=@claude-alive/ui dev
# → Opens at http://localhost:5173 (Vite dev server)
# → The dev server proxies WebSocket to localhost:3141

# Terminal 3: Register hooks and start a Claude Code session
node packages/cli/dist/index.js install
claude   # Start any Claude Code session
```

---

## Contributing / 기여

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes
4. Push and open a Pull Request

PRs should focus on one feature or fix.

---

## License / 라이선스

[MIT](LICENSE)

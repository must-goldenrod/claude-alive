# Changelog

All notable changes to claude-alive.



## v0.5.1 (2026-05-14)

### New Features

-  Claude 질문 시 amber 알림 체인 통합 / Surface Claude questions via amber attention chain
-  Prompt 탭 Dashboard/Prompts 분리 + sticky 질문 상태 / Split Prompt tab into Dashboard/Prompts sub-tabs + sticky waiting state
-  think-prompt 완전 흡수 - 단일 서버 통합 / Fully absorb think-prompt into unified server
-  think-prompt 패키지 흡수 — D-048 / Absorb think-prompt packages (D-048)
-  autostart 통합 + Prompt 탭에 D-046 confidence/delta 노출 / Unified autostart + D-046 confidence/delta in Prompt tab
-  think-prompt 통합 — 단일 설치/시작 + Prompt 탭 / Unified install + Prompt tab via think-prompt
-  터미널 X 확인 모달·이름 수정 펜슬 어포던스·탭 드래그앤드롭 / Terminal close confirm modal, rename pencil affordance, tab drag-and-drop reorder
-  권한 요청 Notification 훅을 waiting 상태로 매핑 / Map permission-request Notification hook to waiting state
-  CPU/RAM 임계값 알럿 + 설정 탭 + 헤더 로고·파비콘 / Resource usage alerts with configurable thresholds + alerts settings tab + header logo & favicon
-  폴더 picker의 '이전 세션'을 '최근 폴더 히스토리'로 교체 / Replace 'Previous sessions' with 'Recent folders' history in folder picker
-  설정 모달 추가 (사운드·터미널) + 사운드 enable/볼륨 제어 / Add Settings modal (sound, terminal) + sound enable/volume controls
-  despawning 한국어 번역 추가 + 1분 후 자동 제거 / Add despawning Korean translation + auto-prune after 1 min
-  활성 상태 시각 동질화·외부 뱃지 위치 변경·알림 사운드 추가 / Unify active-state visuals, relocate external badge, add notification sounds
-  사이드바·픽셀 캐릭터·터미널 탭 3-way 선택 동기화 + 외부 세션 EXT 표시 / 3-way selection sync (sidebar/pixel/terminal) + external session EXT badge
-  에이전트 클릭 시 해당 터미널 탭 자동 포커스 / Auto-focus terminal tab when agent is clicked
-  사이드바 리사이즈·New Chat 버튼·SSH 패딩 정규화 / Resizable sidebar, New Chat button, SSH padding normalization
-  에이전트 권한 요청·오류 시 브라우저 네이티브 알림 / Browser native notifications for permission requests and errors
-  대시보드 2-뷰 분리·시스템 메트릭·SSH 프리젠스·세션 재개 / 2-view dashboard split, system metrics, SSH presence, session resume
-  작업 완료 시 알림 사운드 재생 / Play completion sound on agent done

### Bug Fixes

-  외부 뱃지를 챗 활성 탭 기준으로 정확히 표시 / Drive external badge from currently-open chat tabs
-  다른 hook 타입과 공존 시 install/uninstall TypeError 수정 / Guard against non-command hook entries
-  update ChatOverlay test for new minimize button

### Refactoring

-  프로젝트 이름 cwd 기반 단일 편집 지점으로 통합 / Unify project naming via single cwd-keyed store

### Maintenance

-  파비콘 디자인 업데이트 / Update favicon design
-  AgentTimelinePanel 제거 / Remove AgentTimelinePanel
## v0.3.1 (2026-03-04)

### New Features

-  replace mock echo with Claude CLI subprocess streaming
-  integrate ChatOverlay into PixelOfficePage
-  add ChatOverlay component with pixel theme

### Refactoring

-  remove xterm.js terminal files and dependencies
-  remove TerminalPanel from App and UnifiedView
## v0.3.0 (2026-03-04)

### New Features

-  add embedded xterm.js terminal panel
-  add terminal WebSocket endpoint /ws/terminal
-  add PtyManager for terminal sessions
-  display token usage in stats and completion log
-  integrate transcript parsing into agent lifecycle
-  add transcript JSONL parser for token usage
-  add AgentStats component to RightPanel
-  add stats API endpoint and WS broadcast
-  add getStats() with subagent/tool aggregation

### Documentation

-  add dashboard enhancements design and implementation plan

### Other

- test: add coverage for stats API, token usage, and terminal WS
## v0.2.3 (2026-03-03)

### Bug Fixes

-  replace all hardcoded English strings with translation keys
## v0.2.2 (2026-03-02)

### New Features

-  add security hardening, test suite (145 tests), CI/CD, and changelog
-  auto-set subagent displayName from agent_type hook field
-  redesign UI with Toss-style typography, colors, and spacing

### Bug Fixes

-  correct version quoting in build-npm.sh heredoc
-  restore version and fix release script version calculation

### Documentation

-  add dashboard screenshot to README

### Maintenance

-  remove all Live2D references
## v0.2.0 (2026-03-01)

### New Features

-  publish to npmjs.com + add version management
-  add zoom buttons, sidebar agent navigation, idle bubble text
-  replace Live2D with pixel office + add org chart overlay
-  replace gallery modal with tab-based page navigation
-  replace Mark/Natori with Mao, Ren, Wanko models
-  add character gallery to browse all Live2D models
-  add npm single-package build pipeline
-  enhance pixel/bishoujo engines, add session tracking, remove legacy packages
-  add bishoujo/unified views, enhance pixel engine and style system
-  restructure UI views, add i18n, improve event stream readability
-  enhanced agent info with rename, project path, metadata
-  unified app with 4 UI styles (dashboard, pixel, 3D, hybrid) + style selector
-  3D battlefield UI with Three.js, procedural robot agents, particle effects
-  add WebSocket integration, matrix spawn/despawn effects, status overlay
-  add character system with sprites, FSM, pathfinding, seat assignment
-  scaffold pixel art office with game engine, tilemap, camera, z-sort renderer
-  serve dashboard UI as static files + E2E integration test
-  add CSS animations, activity pulse, stats bar, enhanced agent cards
-  scaffold React + TailwindCSS dashboard with WebSocket hook
-  add install/uninstall/start/status commands
-  hook script + auto-installer for settings.json
-  HTTP event receiver + WebSocket broadcaster
-  add event types, agent FSM, session store, WS protocol

### Bug Fixes

-  map Bash tool to running animation for correct bubble text
-  remove all Live2D proprietary files from git tracking
-  resolve npm bin entry and publish to GitHub Packages
-  auto-create agents for pre-existing sessions + accept raw hook stdin

### Documentation

-  rewrite README with bilingual EN/KO detailed documentation
-  rewrite README for open-source release
-  add README

### Refactoring

-  remove dashboard view, make pixel office the default

### Maintenance

-  prepare for open-source release

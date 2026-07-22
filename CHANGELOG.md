# Changelog

All notable changes to claude-alive.

## Unreleased (2026-07-22)

### New Features

-  종료 티켓 아카이빙 + 시점별 상세 뷰, 완료 신호 일원화 등 P0 (#42)
-  스프레드 뷰 인라인 입력·리사이즈 타일링·단축키·호버 힌트 / Interactive spread view: inline input, resizable tiling, shortcuts, hover hints
-  에이전트 카드에서 이름 변경 (프로젝트 이름과 통일) / Rename from agent card, unified with project name
-  세션 영속화·재개 + 에이전트 대시보드 / Session persistence, resume + agent dashboard
-  리포트 4종 — 프로젝트 비교·추세 회귀·캐시 효율·주간 요약 / Four reports: project, trend, cache, weekly (#40)
-  개선 후보 + numpy 제거 + 세션 종료 자동 collect / Improvement candidates, drop numpy, auto-collect (#39)
-  개선 후보(L1) — 세션 내 반복 Bash·편집 식별 + 터미널 뷰 충돌 처리 / Improvement candidates (L1) + terminal view-conflict handling
-  전용 대시보드 뷰 — 다축 프로파일·산점도·분포·다축시계열 / Dedicated Efficio dashboard view
-  점수 영속화 + 서버 읽기 브리지 + RightPanel efficio 패널 / Persist scores, server read bridge, efficio panel
-  기준선 노출 + 라운드3 사전등록 / Expose counterfactual baseline + round-3 pre-registration
-  MTMM 3번째 방법 + 2차원(체감/행동) 축 / MTMM 3rd method + two-dimension axes
-  M0 단일세션 효율 평가 도구 + H1 기준타당도 검증 / Efficio M0 single-session eval tool + H1 criterion validation

### Bug Fixes

-  launchd 실행 시 `command not found: claude` 수정 (PATH 보강) / Fix "command not found: claude" under launchd (augment PATH)
-  재시작 후 빈 터미널 수정 — dormant 메시지 미전달 + unknown 탭 자체 재개 / Fix blank terminals after restart — undelivered dormant + client self-resume
-  세션 영속화·재개 코드 리뷰 지적 전면 수정 / Fix all review findings in session persistence & resume
-  재연결 시 빈 화면 복원 수정 (강제 재그리기) + 옛 탭 폐기 / Fix blank restore on reattach (force redraw) + drop legacy tabs
-  New Chat이 기존 세션에 attach되던 회귀 수정 (tabId 전역 유일화) / Fix New Chat attaching to a stale session (globally-unique tabId)
-  WC↔rework tautology 검정 + 정직한 다기준 검증상태 / WC-rework tautology check + honest multi-criterion labels
-  잔차 드리프트 고정 — 고정 기준 모델 도입 / Fix residual drift with frozen reference model

### Documentation

-  LLM 티켓 서비스 생애주기 개발 계획서 (#43)
-  세션 영속화·재개 + 에이전트 대시보드 설계 / Session persistence, resume + agent dashboard design
-  전용 뷰 완료 반영 + E2E 증거물 gitignore / Mark dedicated view done, ignore E2E artifacts
-  README에 Efficio 설치·사용법 섹션 추가 / Add Efficio install & usage section to README
-  개발 현황 추적 문서 추가 / Add development status & backlog tracker
-  EFA로 13.5 완화 + 평정자 신뢰도 도구 / EFA tempers 13.5 + multirater reliability tooling
-  검증 방법론 문헌 대조 리뷰 + 재현 검사 / Methodology literature review + reproducibility checks
-  13.2 'W2 우위' supersede 포인터(→13.4) / Reconcile W2-primary claim with 13.4 finding
-  자기점검 #4 — 객관적 rework 프록시 검증 / Objective rework proxy validation

### Maintenance

-  실수로 커밋된 테스트 스크린샷 제거 / Remove accidentally committed test screenshot

### Other

- 멀티 에이전트 canonical 기반 P0 완료 + P1 배선 + Codex 어댑터 / Canonical foundation (P0), wiring (P1), and the Codex adapter (#41)
- test+docs(efficio): W2 작업유형 교란 검증 + profile 통합테스트 / W2 task-type confound check + profile integration tests

## v0.5.8 (2026-06-10)

### New Features

-  의사결정 요청 알림 사운드 + 탭 대기중 상태 표시 / Add decision-request sound and waiting tab status (#30)

### Bug Fixes

-  주황색 대기 상태를 의사결정 요청에만 한정 / Limit amber waiting state to decision requests (#31)
-  훅 fire-and-forget 로 인한 프롬프트 수집 유실 수정 / Fix prompt collection loss from fire-and-forget hook (#29)
-  알림 사운드 자동재생 차단 해결 / Fix notification sounds blocked by autoplay policy (#28)
## v0.5.7 (2026-05-20)

### New Features

-  claude agents 명령 선택 + 통합 실행 바 / Add claude agents entrypoint with unified launch bar (#25)

### Bug Fixes

-  기본 claude 변형에도 placeholder SessionStart 적용 / Apply placeholder SessionStart to default claude variant
-  claude agents 사이드바 미표시/세션 불일치 수정 / Fix claude agents sidebar mismatch (#27)
-  claude agents 에서 --session-id 옵션 오류 수정 / Fix unknown --session-id error for claude agents (#26)
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

# Changelog

All notable changes to claude-alive.

## Unreleased (2026-03-02)

### New Features

-  auto-set subagent displayName from agent_type hook field
-  redesign UI with Toss-style typography, colors, and spacing

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

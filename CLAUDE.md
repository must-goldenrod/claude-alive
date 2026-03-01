# CLAUDE.md

## 프로젝트 개요

claude-alive: Claude Code 에이전트 모니터링 대시보드. 실시간 WebSocket으로 에이전트 상태를 추적하고 시각화.

## 기술 스택

- **Monorepo**: pnpm + Turborepo
- **프론트엔드**: React 19, Vite 6, Tailwind CSS 4, TypeScript 5.7
- **통신**: WebSocket 실시간 스트리밍 (`useWebSocket` hook)
- **i18n**: i18next (EN/KO)

## 아키텍처

### 통합 레이아웃 (UnifiedView)
3-Column 구조:
- **왼쪽**: `ProjectSidebar` (280px) — 프로젝트별 에이전트 그룹, 접힘/펼침
- **중앙**: 에이전트 상태 표시 영역
- **오른쪽**: `RightPanel` (320px) — ActivityPulse + EventStream

단일 WebSocket 연결로 React 상태를 피드.

### 주요 데이터 타입 (core 패키지)
- `AgentInfo` — sessionId, state, parentId (서브에이전트 판별), displayName, cwd, currentTool
- `WSServerMessage` — snapshot / agent:spawn / agent:despawn / agent:state / agent:prompt / event:new

## 빌드 & 실행

```bash
pnpm install
pnpm run dev          # 전체 dev 서버
pnpm run build --filter=@claude-alive/ui   # UI 빌드
pnpm --filter=@claude-alive/ui exec tsc --noEmit      # 타입 체크
```

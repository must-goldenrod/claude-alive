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
- **왼쪽**: `ProjectSidebar` (300px) — 프로젝트별 에이전트 그룹, 접힘/펼침
- **중앙**: 에이전트 상태 표시 영역 (PixelCanvas)
- **오른쪽**: `RightPanel` (360px) — ActivityPulse + CompletionLog + EventStream
- **상단**: `HeaderBar` (56px) — 타이틀 + 언어 토글

단일 WebSocket 연결로 React 상태를 피드.

### 디자인 시스템
- **폰트**: UI 텍스트 `Pretendard / system-ui` (--font-ui), 코드/시간 `SF Mono` (--font-mono)
- **컬러 토큰**: CSS 변수 기반 다크 테마 (--bg-primary: #0d1117, --accent-blue: #58a6ff 등)
- **라운딩**: 카드/패널 `rounded-xl` (12px), 버튼 8~10px, 에이전트 카드 `rounded-2xl`
- **여백 기준**: 패딩 20~24px, 카드 간 gap 4~8px
- **hover**: `background-color` 변화 + 미세 `translateY(-1px)` (Toss 스타일)
- **스크롤바**: 6px 얇은 커스텀 스크롤바

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

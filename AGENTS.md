# AGENTS.md

## 프로젝트 개요

Codex-alive: Codex 에이전트 모니터링 대시보드. 실시간 WebSocket으로 에이전트 상태를 추적하고 픽셀 오피스로 시각화.

## 기술 스택

- **Monorepo**: pnpm + Turborepo
- **프론트엔드**: React 19, Vite 6, Tailwind CSS 4, TypeScript 5.7
- **서버**: Node.js + ws (WebSocket), Zod (port 3141)
- **통신**: WebSocket 실시간 스트리밍 (`useWebSocket` hook)
- **i18n**: i18next (EN/KO), 모든 UI 텍스트 번역 필수
- **배포**: npm 패키지 배포 (`scripts/release.sh`)

## 패키지 구조

```
packages/
├── cli/      # Codex-alive CLI (설치/관리)
├── core/     # 공유 타입, AgentFSM, SessionStore, 프로토콜
├── hooks/    # Codex 훅 등록 (17개 이벤트 → HTTP POST)
├── i18n/     # i18next 설정 + EN/KO 번역 파일
├── server/   # HTTP + WebSocket 서버 (port 3141)
└── ui/       # React 프론트엔드 (Vite)
```

## 아키텍처

### 데이터 흐름
```
Codex Hook → HTTP POST → Server → WebSocket → UI (React)
```

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
- `AgentState` — spawning | idle | listening | active | waiting | error | done | despawning | removed
- `WSServerMessage` — snapshot / agent:spawn / agent:despawn / agent:state / agent:prompt / event:new
- `HookEventName` — 17개 훅 이벤트 (SessionStart, PreToolUse, SubagentStart 등)

### i18n 규칙
- 모든 UI 텍스트는 `packages/i18n/src/locales/{en,ko}.json` 번역 키 사용 필수
- React 컴포넌트: `useTranslation()` 훅 → `t('key')`
- 비-React 코드 (canvas, class component): `import i18n from '@Codex-alive/i18n'` → `i18n.t('key')`
- 하드코딩된 문자열 금지 (fallback 포함)

## 빌드 & 실행

```bash
pnpm install
pnpm run dev          # 전체 dev 서버
pnpm run build        # 전체 빌드
pnpm run build --filter=@Codex-alive/ui   # UI만 빌드
pnpm --filter=@Codex-alive/ui exec tsc --noEmit      # 타입 체크
```

## 릴리즈

```bash
pnpm run release:patch   # 0.x.Y → 패치 버전 업
pnpm run release:minor   # 0.X.0 → 마이너 버전 업
pnpm run release:major   # X.0.0 → 메이저 버전 업
```

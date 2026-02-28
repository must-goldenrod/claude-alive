# CLAUDE.md

## 프로젝트 개요

claude-alive: Claude Code 에이전트 모니터링 대시보드. 실시간 WebSocket으로 에이전트 상태를 추적하고, Live2D 비쇼죠 뷰로 시각화.

## 기술 스택

- **Monorepo**: pnpm + Turborepo
- **프론트엔드**: React 19, Vite 6, Tailwind CSS 4, TypeScript 5.7
- **Live2D 비쇼죠**: PixiJS v8 + @naari3/pixi-live2d-display v1.2.5 — lazy-loaded
- **통신**: WebSocket 실시간 스트리밍 (`useWebSocket` hook)
- **i18n**: i18next (EN/KO)

## 아키텍처

### 통합 레이아웃 (UnifiedView)
3-Column 구조:
- **왼쪽**: `ProjectSidebar` (280px) — 프로젝트별 에이전트 그룹, 접힘/펼침
- **중앙**: Bishoujo (Live2D) 캔버스
- **오른쪽**: `RightPanel` (320px) — ActivityPulse + EventStream

단일 WebSocket 연결로 React 상태를 피드.

### 비쇼죠 Live2D 뷰 (`views/bishoujo/`)
- `components/BishoujoCanvas.tsx` — PixiJS v8 캔버스 + Live2D 모델 관리, 애니메이션 루프
- `components/UIOverlay.tsx` — DOM 오버레이 (이름표, 말풍선, 호버/클릭 인터랙션)
- `engine/constants.ts` — 8개 슬롯(3행: back/mid/front), 모델 카탈로그 5종(Haru/Hiyori/Mark/Natori/Rice)
- `engine/live2dManager.ts` — `window.PIXI` 설정, `Live2DModel.from()` 모델 로딩
- `engine/parameterMapper.ts` — AgentState → Live2D 파라미터 매핑 (표정/시선/자세)
- `engine/sceneLayout.ts` — 슬롯 배정 (에이전트 수 기반 레이아웃 + 소수 에이전트 자동 스케일업)
- `engine/interactionHandler.ts` — 마우스 트래킹, 클릭 반응, 드래그 상태
- `engine/moodSystem.ts` — 무드 누적 (행복/에너지/스트레스) → 표정 오프셋

#### Live2D Retina 뷰포트 핵심 이슈
라이브러리(`_onRenderCallback`)가 CSS 픽셀(`renderer.width/height`)로 viewport 설정 → Retina(devicePixelRatio=2)에서 물리 캔버스의 절반만 사용 → 모델이 좌하단 1/4에 렌더링.
**해결**: `internalModel.draw()`를 패치하여 `setRenderState` 직전에 `viewport = [0, 0, gl.canvas.width, gl.canvas.height]`로 교정. projection matrix(CSS 기반) + 물리 viewport = 정확한 좌표 매핑.

#### 슬롯 레이아웃
```
행      Y위치   스케일   캐릭터수
Back    0.28    0.06-07  3
Mid     0.52    0.09-10  3
Front   0.82    0.14     2
```
소수 에이전트 자동 스케일: 1명=2.0x, 2명=1.6x, 3명=1.3x

### 핵심 패턴
- **Lazy loading**: Bishoujo 컴포넌트는 lazy-loaded (~1MB+ 절약)
- **Live2D draw 패치**: `internalModel.draw()` 래핑으로 viewport CSS→물리 픽셀 교정 필수 (Retina)

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

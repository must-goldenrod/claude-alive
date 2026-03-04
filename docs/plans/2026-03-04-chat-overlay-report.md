# Chat Overlay 구현 보고서

**작업일**: 2026-03-04
**프로젝트**: claude-alive (에이전트 모니터링 대시보드)
**작업 범위**: 터미널 UI → 채팅 오버레이 전환

---

## 1. 작업 배경

기존 하단 TerminalPanel(xterm.js 기반 쉘 에뮬레이터)을 제거하고, 픽셀 캔버스 위에 반투명 채팅 오버레이를 배치하여 에이전트와의 대화 인터페이스로 전환. 프로젝트의 픽셀아트 미학에 맞춘 8bit 테마 입력창과 모던 버블 메시지를 결합.

## 2. 주요 변경 사항

### 추가된 파일

| 파일 | 설명 |
|------|------|
| `packages/ui/src/views/chat/ChatOverlay.tsx` (267줄) | 채팅 오버레이 컴포넌트 |

### 수정된 파일

| 파일 | 변경 내용 |
|------|-----------|
| `packages/ui/src/views/pixel/PixelOfficePage.tsx` | ChatOverlay import, chatOpen state, ▣ 토글 버튼 추가 (+32줄) |
| `packages/ui/src/App.tsx` | TerminalPanel 참조 제거 |
| `packages/ui/src/views/unified/UnifiedView.tsx` | TerminalPanel 참조 제거 |
| `packages/ui/package.json` | @xterm/xterm, @xterm/addon-fit 의존성 제거 |
| `packages/i18n/src/locales/en.json` | terminal 키 삭제, chat 키 추가 |
| `packages/i18n/src/locales/ko.json` | terminal 키 삭제, chat 키 추가 |
| `pnpm-lock.yaml` | xterm 패키지 제거 반영 |

### 삭제된 파일

| 파일 | 설명 |
|------|------|
| `packages/ui/src/views/terminal/TerminalPanel.tsx` (229줄) | xterm.js 터미널 UI |
| `packages/ui/src/views/terminal/useTerminalWS.ts` (63줄) | 터미널 WebSocket 훅 |

### 변경 통계

- **10개 파일** 변경
- **+314줄** 추가 / **-329줄** 삭제 (순 -15줄)
- **2개 npm 의존성** 제거 (@xterm/xterm, @xterm/addon-fit)

## 3. 구현 상세

### ChatOverlay 컴포넌트

```
┌──────────────────────────────────────────┐
│              Pixel Canvas                │
│                                          │
│   ┌── ChatOverlay (반투명) ────────┐    │
│   │  ■ Chat              ✕        │    │
│   │  ─────────────────────         │    │
│   │  ■ Agent  ╭──────────╮        │    │
│   │  ┌─┐     │ 메시지... │        │    │
│   │  └─┘     ╰──────────╯        │    │
│   │          ╭──────────╮ □ You   │    │
│   │          │ 입력...   │ ┌─┐    │    │
│   │          ╰──────────╯ └─┘    │    │
│   │  ─────────────────────         │    │
│   │  ╔═══════════════════════╗    │    │
│   │  ║ ■□ placeholder  ▶▶  ║    │    │
│   │  ╚═══════════════════════╝    │    │
│   └────────────────────────────────┘    │
│                              [▣]         │
└──────────────────────────────────────────┘
```

**오버레이 스타일:**
- 위치: 캔버스 중앙 하단, `position: absolute`
- 크기: `min(480px, 90vw)`, 최대 높이 `60vh`
- 배경: `rgba(13, 17, 23, 0.88)` + `backdrop-filter: blur(12px)`
- z-index: 30 (기존 오버레이들보다 상위)

**입력창 (픽셀 테마):**
- 더블라인 테두리 (`border: 2px solid`)
- 좌측: `■□` 픽셀 아이콘
- 우측: `▶▶` 전송 버튼 (입력 시 green 활성화)
- Enter 전송, Shift+Enter 줄바꿈
- textarea 자동 높이 조절 (최대 120px)

**메시지 버블:**
- 에이전트: 좌측 정렬, `■` 퍼플 아바타, `var(--bg-card)` 배경
- 유저: 우측 정렬, `□` 블루 아바타, `rgba(88, 166, 255, 0.15)` 배경
- `rounded-14px` 버블, `var(--font-ui)` 폰트

**토글 버튼:**
- 캔버스 우하단 `▣` 아이콘 (40x40px)
- 기존 줌 컨트롤과 동일한 스타일 패턴
- 채팅 열림 시 자동 숨김

## 4. 검증 결과

| 항목 | 결과 |
|------|------|
| TypeScript 타입 체크 (`tsc --noEmit`) | PASS |
| 전체 빌드 (`pnpm run build`) | PASS (4.05s) |
| 빌드 모듈 수 | 83 modules |
| UI 번들 크기 | 262.63 kB (gzip: 83.06 kB) |

## 5. 커밋 이력

| 해시 | 메시지 |
|------|--------|
| `7cd5a6b` | feat(i18n): add chat overlay translation keys |
| `9eb940c` | feat(ui): add ChatOverlay component with pixel theme |
| `add30eb` | feat(ui): integrate ChatOverlay into PixelOfficePage |
| `83af91f` | refactor(ui): remove TerminalPanel from App and UnifiedView |
| `0195afc` | refactor(ui): remove xterm.js terminal files and dependencies |

## 6. 후속 작업

- **서버 연동**: 현재 Mock 에코 응답. 실제 에이전트 통신을 위한 WebSocket 메시지 프로토콜 구현 필요
- **서버 PTY 코드 정리**: `packages/server/src/ptyManager.ts`, `wsServer.ts`의 터미널 관련 코드 제거 검토
- **에이전트 스프라이트 아바타**: 현재 `■/□` 텍스트 아이콘 → 실제 픽셀 스프라이트 썸네일로 교체 가능

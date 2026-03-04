# Chat Overlay Design — Terminal → Chat 전환

## 요약

기존 TerminalPanel(xterm.js 기반 쉘 에뮬레이터)을 제거하고, 픽셀 캔버스 위에 반투명 채팅 오버레이를 배치. 에이전트와의 대화 인터페이스로 전환.

## 디자인 결정

- **목적**: 에이전트와의 대화 (쉘 명령 실행 아님)
- **입력창**: 8bit 픽셀 테마 (더블라인 테두리, 픽셀 아이콘)
- **메시지**: 모던 둥근 버블 + 픽셀 스프라이트 아바타
- **배치**: 픽셀 캔버스 위 반투명 오버레이 (게임 HUD 느낌)
- **접근**: TerminalPanel 완전 교체 (xterm.js 제거)

## 레이아웃

```
┌──────────────────────────────────────────┐
│  [ HeaderBar - 56px ]                    │
├──────────────────────────────────────────┤
│                                          │
│         Pixel Canvas (full area)         │
│                                          │
│   ┌── ChatOverlay (반투명) ────────┐    │
│   │  Messages (scrollable)         │    │
│   │  ╔═══════════════════════════╗ │    │
│   │  ║ ■□ 입력...         ▶▶   ║ │    │
│   │  ╚═══════════════════════════╝ │    │
│   └────────────────────────────────┘    │
│                                          │
│                         [💬 toggle btn]  │
└──────────────────────────────────────────┘
```

## ChatOverlay 스타일

- `position: absolute`, 캔버스 중앙 하단
- 너비: `min(480px, 90vw)`, 최대 높이: `60vh`
- 배경: `rgba(13, 17, 23, 0.88)` + `backdrop-filter: blur(12px)`
- 테두리: `1px solid var(--border-color)`, `rounded-2xl`
- 토글: 캔버스 우하단 픽셀 말풍선 아이콘

## 메시지 버블

- **에이전트**: 좌측 정렬, 픽셀 스프라이트 썸네일(28x28) + `rounded-xl` 버블, 배경 `var(--bg-card)`
- **유저**: 우측 정렬, 유저 픽셀 아바타 + `rgba(88, 166, 255, 0.15)` 버블
- 타임스탬프: 모노 폰트 11px, `--text-secondary`

## 픽셀 입력창

- 더블라인 테두리 (`border: 2px solid var(--border-color)`, 직각 모서리)
- 좌측: 픽셀 도트 아이콘 `■□`
- 중앙: auto-expanding textarea, Pretendard 폰트
- 우측: `▶▶` 전송 버튼 (`--accent-green` hover)
- Enter 전송, Shift+Enter 줄바꿈

## 파일 변경

- **삭제**: `views/terminal/TerminalPanel.tsx`, `views/terminal/useTerminalWS.ts`
- **생성**: `views/chat/ChatOverlay.tsx`
- **수정**: `App.tsx`, `UnifiedView.tsx` — TerminalPanel → ChatOverlay
- **수정**: `package.json` — xterm 의존성 제거
- **수정**: i18n — terminal 키 → chat 키

## 데이터 흐름

초기 구현: 로컬 상태 기반 메시지 관리. 서버 연동은 후속 작업.

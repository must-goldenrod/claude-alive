# Chat Overlay → Claude Code CLI 연동 구현 보고서

**작업일**: 2026-03-04
**프로젝트**: claude-alive (에이전트 모니터링 대시보드)
**작업 범위**: ChatOverlay의 Mock echo 응답을 실제 Claude Code CLI 연동으로 교체

---

## 1. 작업 배경

ChatOverlay UI는 이전 단계에서 구현 완료되었으나, 사용자 메시지를 그대로 echo하는 Mock 응답만 반환하는 상태였다. 이번 작업에서 서버가 `claude` CLI를 subprocess로 스폰하고, `--output-format stream-json`으로 스트리밍 응답을 받아 WebSocket을 통해 UI에 실시간 전달하는 전체 파이프라인을 구현했다.

### 데이터 흐름

```
User → ChatOverlay → WS { chat:send } → Server → spawn claude -p "msg" --output-format stream-json
                                                    ↓
Server ← stdout (stream-json lines) ← claude process
  ↓
WS { chat:chunk } → UI (실시간 스트리밍 렌더링)
WS { chat:end }   → UI (응답 완료)
```

**보너스 효과**: claude 프로세스가 hooks 설치된 환경에서 실행되므로, SessionStart/PreToolUse 등 이벤트가 자동 발생하여 픽셀 캔버스에 에이전트가 자동 표시된다.

---

## 2. 주요 변경 사항

### 추가된 파일

| 파일 | 줄 수 | 설명 |
|------|-------|------|
| `packages/server/src/claudeChat.ts` | 90줄 | Claude CLI 매니저 — subprocess 스폰, stream-json 파싱, 세션 resume |

### 수정된 파일 (8개)

| 파일 | 변경 내용 |
|------|-----------|
| `packages/core/src/protocol/wsProtocol.ts` | `WSClientMessage`에 `chat:send` 추가, `WSServerMessage`에 `chat:chunk`/`chat:end`/`chat:error` 추가 |
| `packages/server/src/wsServer.ts` | `send()` 메서드 public 전환, `onClientMessage` 콜백 옵션 추가 |
| `packages/server/src/index.ts` | `ClaudeChat` 인스턴스 생성, `onClientMessage`로 chat:send 라우팅, SIGINT 정리 추가 |
| `packages/ui/src/views/dashboard/hooks/useWebSocket.ts` | `send(msg: WSClientMessage)` 함수를 반환값에 추가 |
| `packages/ui/src/views/chat/ChatOverlay.tsx` | Mock echo 제거, `onSend`/`chatEventRef` props 추가, 스트리밍 상태 관리 구현 |
| `packages/ui/src/views/pixel/PixelOfficePage.tsx` | `send` 디스트럭처링, `chatHandlerRef` 생성, chat WS 이벤트 라우팅 |
| `packages/i18n/src/locales/en.json` | `chat.streaming`, `chat.error` 키 추가 |
| `packages/i18n/src/locales/ko.json` | `chat.streaming`, `chat.error` 키 추가 |

### 수정된 테스트

| 파일 | 변경 내용 |
|------|-----------|
| `packages/ui/src/__tests__/ChatOverlay.test.tsx` | Mock echo 테스트 제거, `onSend` 콜 검증 추가, `chatEventRef` 스트리밍/에러 테스트 추가 (9 → 10 테스트) |

---

## 3. 설계 결정

### 3.1 ClaudeChat 클래스 (`claudeChat.ts`)

- **단일 인스턴스**: 서버당 하나의 `ClaudeChat` 인스턴스. 한 번에 하나의 대화 세션만 유지.
- **세션 resume**: 첫 호출 후 `session_id`를 저장하여 이후 `--resume SESSION_ID`로 대화 이어감.
- **자동 kill**: 이전 프로세스가 실행 중일 때 새 메시지가 오면 SIGTERM으로 이전 프로세스 종료 후 새로 스폰.
- **stream-json 파싱**: `readline`으로 stdout 라인별 파싱. `type: 'assistant'` 메시지의 `content[].text`를 추출, `type: 'result'`에서 세션 종료 처리.

### 3.2 WebSocket 확장 (`wsServer.ts`)

- `send()`를 public으로 전환하여 특정 클라이언트에 chat 메시지를 직접 전송 가능하게 함.
- `onClientMessage` 콜백으로 `ping`/`request:snapshot` 외 메시지를 서버 진입점으로 위임.

### 3.3 UI 스트리밍 패턴 (`ChatOverlay.tsx`)

- `chatEventRef` (MutableRefObject)를 사용한 이벤트 라우팅: PixelOfficePage가 WS 메시지를 받아 ref를 통해 ChatOverlay에 전달.
- `streamingMsgIdRef`로 현재 스트리밍 중인 메시지 ID 추적, chunk 누적.
- 스트리밍 중 커서 `▍` 표시로 진행 상태 시각화.

---

## 4. 프로토콜 상세

### 클라이언트 → 서버

```typescript
{ type: 'chat:send'; message: string }
```

### 서버 → 클라이언트

```typescript
{ type: 'chat:chunk'; text: string; sessionId: string }    // 텍스트 스트리밍 조각
{ type: 'chat:end'; sessionId: string; costUsd?: number }   // 응답 완료
{ type: 'chat:error'; error: string; sessionId: string | null }  // 에러 발생
```

---

## 5. 검증 결과

| 검증 항목 | 결과 |
|-----------|------|
| `tsc --noEmit` (core) | Pass |
| `tsc --noEmit` (server) | Pass |
| `tsc --noEmit` (ui) | Pass |
| `pnpm run build` (전체) | Pass (5 packages, 3.41s) |
| Server 테스트 (46 tests) | Pass |
| UI 테스트 (22 tests) | Pass |

---

## 6. 향후 고려사항

- **다중 클라이언트**: 현재 `ClaudeChat`은 단일 인스턴스로, 마지막으로 `chat:send`한 클라이언트의 응답만 처리. 다중 사용자 지원 시 클라이언트별 세션 분리 필요.
- **비용 추적**: `chat:end`에 `costUsd` 필드가 포함되나 UI에서는 아직 미표시. 향후 사용량 대시보드에 반영 가능.
- **메시지 히스토리 영속화**: 현재 채팅 히스토리는 브라우저 메모리에만 존재. 서버 재시작/페이지 새로고침 시 유실.

# Chat Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 기존 TerminalPanel(xterm.js)을 제거하고, 픽셀 캔버스 위 반투명 채팅 오버레이로 교체

**Architecture:** ChatOverlay 컴포넌트가 PixelOfficePage의 기존 오버레이 패턴(zoom buttons, AgentTimelinePanel)을 따라 position:absolute로 캔버스 위에 배치. 메시지는 로컬 state로 관리. 픽셀 테마 입력창 + 모던 버블 + 스프라이트 아바타.

**Tech Stack:** React 19, TypeScript 5.7, Tailwind CSS 4, CSS Variables (기존 디자인 토큰)

---

### Task 1: i18n 키 추가 (terminal → chat)

**Files:**
- Modify: `packages/i18n/src/locales/en.json:144-149`
- Modify: `packages/i18n/src/locales/ko.json:144-149`

**Step 1: en.json에 chat 키 추가, terminal 키 유지(후속 삭제)**

```json
"chat": {
  "title": "Chat",
  "placeholder": "Send a message...",
  "send": "Send",
  "you": "You",
  "agent": "Agent"
}
```

`terminal` 블록 바로 뒤에 추가.

**Step 2: ko.json에 chat 키 추가**

```json
"chat": {
  "title": "채팅",
  "placeholder": "메시지를 입력하세요...",
  "send": "보내기",
  "you": "나",
  "agent": "에이전트"
}
```

**Step 3: Commit**

```bash
git add packages/i18n/src/locales/en.json packages/i18n/src/locales/ko.json
git commit -m "feat(i18n): add chat overlay translation keys"
```

---

### Task 2: ChatOverlay 컴포넌트 생성

**Files:**
- Create: `packages/ui/src/views/chat/ChatOverlay.tsx`

**Step 1: ChatOverlay 컴포넌트 작성**

```tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

interface ChatOverlayProps {
  open: boolean;
  onToggle: () => void;
}

export function ChatOverlay({ open, onToggle }: ChatOverlayProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const sendMessage = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    // Mock agent response (placeholder — real integration later)
    setTimeout(() => {
      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: trimmed,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, agentMsg]);
    }, 600);
  }, [input]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(480px, 90vw)',
        maxHeight: '60vh',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(13, 17, 23, 0.88)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--border-color)',
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            letterSpacing: '0.05em',
          }}
        >
          ■ {t('chat.title')}
        </span>
        <button
          onClick={onToggle}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 14,
            padding: '2px 6px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: 120,
          maxHeight: 'calc(60vh - 110px)',
        }}
      >
        {messages.map(msg => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              alignItems: 'flex-end',
              gap: 8,
            }}
          >
            {/* Pixel avatar */}
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: msg.role === 'agent' ? 'var(--accent-purple)' : 'var(--accent-blue)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                color: '#fff',
                fontFamily: 'var(--font-mono)',
                flexShrink: 0,
                imageRendering: 'pixelated' as const,
              }}
            >
              {msg.role === 'agent' ? '■' : '□'}
            </div>

            {/* Bubble */}
            <div
              style={{
                maxWidth: '75%',
                padding: '8px 14px',
                borderRadius: 14,
                fontSize: 13,
                lineHeight: 1.5,
                fontFamily: 'var(--font-ui)',
                color: 'var(--text-primary)',
                background: msg.role === 'agent'
                  ? 'var(--bg-card)'
                  : 'rgba(88, 166, 255, 0.15)',
                border: `1px solid ${msg.role === 'agent' ? 'var(--border-color)' : 'rgba(88, 166, 255, 0.25)'}`,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Pixel Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 0,
            border: '2px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}
        >
          {/* Pixel dots */}
          <span
            style={{
              padding: '8px 10px',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-secondary)',
              userSelect: 'none',
              lineHeight: '20px',
            }}
          >
            ■□
          </span>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            rows={1}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              lineHeight: '20px',
              padding: '8px 0',
              resize: 'none',
              maxHeight: 120,
            }}
          />

          {/* Send button */}
          <button
            onClick={sendMessage}
            style={{
              padding: '8px 12px',
              background: 'none',
              border: 'none',
              color: input.trim() ? 'var(--accent-green)' : 'var(--text-secondary)',
              cursor: input.trim() ? 'pointer' : 'default',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              fontWeight: 700,
              transition: 'color 0.2s ease',
              lineHeight: '20px',
            }}
          >
            ▶▶
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: 타입 체크**

Run: `pnpm --filter=@claude-alive/ui exec tsc --noEmit`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add packages/ui/src/views/chat/ChatOverlay.tsx
git commit -m "feat(ui): add ChatOverlay component with pixel theme"
```

---

### Task 3: PixelOfficePage에 ChatOverlay 통합

**Files:**
- Modify: `packages/ui/src/views/pixel/PixelOfficePage.tsx`

**Step 1: import 추가 및 state 추가**

파일 상단 import 영역에 추가:
```tsx
import { ChatOverlay } from '../chat/ChatOverlay.tsx';
```

컴포넌트 내부 state 영역에 추가:
```tsx
const [chatOpen, setChatOpen] = useState(false);
```

**Step 2: ChatOverlay + 토글 버튼 렌더링 추가**

`<div style={{ flex: 1, position: 'relative', minWidth: 0 }}>` 컨테이너 내부, 기존 오버레이들(NotificationBanner 등) 근처에 추가:

```tsx
{/* Chat toggle button — 우하단 */}
<button
  onClick={() => setChatOpen(prev => !prev)}
  style={{
    position: 'absolute',
    bottom: 16,
    right: 16,
    zIndex: 20,
    width: 40,
    height: 40,
    display: chatOpen ? 'none' : 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(22, 27, 34, 0.85)',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: 16,
    transition: 'all 0.2s ease',
  }}
  title={t('chat.title')}
>
  ▣
</button>

{/* Chat overlay */}
<ChatOverlay open={chatOpen} onToggle={() => setChatOpen(false)} />
```

**Step 3: 타입 체크**

Run: `pnpm --filter=@claude-alive/ui exec tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/ui/src/views/pixel/PixelOfficePage.tsx
git commit -m "feat(ui): integrate ChatOverlay into PixelOfficePage"
```

---

### Task 4: App.tsx / UnifiedView에서 TerminalPanel 제거

**Files:**
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/views/unified/UnifiedView.tsx`

**Step 1: App.tsx에서 TerminalPanel 제거**

- import 문 제거: `import { TerminalPanel } from './views/terminal/TerminalPanel.tsx';`
- state 제거: `const [terminalOpen, setTerminalOpen] = useState(false);` 및 `const [terminalHeight, setTerminalHeight] = useState(300);`
- JSX에서 `<TerminalPanel ... />` 제거
- `useState` import에서 사용하지 않게 되면 제거

수정 후 App.tsx:
```tsx
import { Component, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import i18n from '@claude-alive/i18n';
import { HeaderBar } from './components/HeaderBar.tsx';

const PixelOfficePage = lazy(() =>
  import('./views/pixel/PixelOfficePage.tsx').then(m => ({ default: m.PixelOfficePage })),
);

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state: { hasError: boolean; error: Error | null } = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[claude-alive] UI error:', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: '#e5534b', fontFamily: 'monospace', textAlign: 'center' }}>
          <p>{i18n.t('error.somethingWentWrong')}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 12, padding: '6px 16px', cursor: 'pointer' }}
          >
            {i18n.t('error.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <ErrorBoundary>
          <Suspense fallback={null}>
            <PixelOfficePage />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
```

**Step 2: UnifiedView.tsx에서 TerminalPanel 제거**

- import 문 제거: `import { TerminalPanel } from '../terminal/TerminalPanel.tsx';`
- state 제거: `const [terminalOpen, setTerminalOpen] = useState(false);` 및 `const [terminalHeight, setTerminalHeight] = useState(300);`
- JSX에서 `<TerminalPanel ... />` 제거

**Step 3: 타입 체크**

Run: `pnpm --filter=@claude-alive/ui exec tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/ui/src/App.tsx packages/ui/src/views/unified/UnifiedView.tsx
git commit -m "refactor(ui): remove TerminalPanel from App and UnifiedView"
```

---

### Task 5: 터미널 파일 삭제 및 xterm 의존성 제거

**Files:**
- Delete: `packages/ui/src/views/terminal/TerminalPanel.tsx`
- Delete: `packages/ui/src/views/terminal/useTerminalWS.ts`
- Modify: `packages/ui/package.json`

**Step 1: 터미널 파일 삭제**

```bash
rm packages/ui/src/views/terminal/TerminalPanel.tsx
rm packages/ui/src/views/terminal/useTerminalWS.ts
rmdir packages/ui/src/views/terminal/
```

**Step 2: package.json에서 xterm 의존성 제거**

`packages/ui/package.json`의 dependencies에서 제거:
```
"@xterm/addon-fit": "^0.11.0",
"@xterm/xterm": "^6.0.0",
```

**Step 3: pnpm install로 lockfile 업데이트**

Run: `pnpm install`

**Step 4: 타입 체크**

Run: `pnpm --filter=@claude-alive/ui exec tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ui): remove xterm.js terminal files and dependencies"
```

---

### Task 6: i18n terminal 키 정리

**Files:**
- Modify: `packages/i18n/src/locales/en.json`
- Modify: `packages/i18n/src/locales/ko.json`

**Step 1: terminal 키 블록 제거**

en.json과 ko.json 모두에서 `"terminal": { ... }` 블록 제거.

**Step 2: 전체 빌드 확인**

Run: `pnpm run build`
Expected: PASS (빌드 성공)

**Step 3: Commit**

```bash
git add packages/i18n/src/locales/en.json packages/i18n/src/locales/ko.json
git commit -m "chore(i18n): remove unused terminal translation keys"
```

---

### Task 7: 최종 검증

**Step 1: 전체 타입 체크**

Run: `pnpm --filter=@claude-alive/ui exec tsc --noEmit`
Expected: PASS

**Step 2: 전체 빌드**

Run: `pnpm run build`
Expected: PASS

**Step 3: dev 서버 실행하여 시각적 확인**

Run: `pnpm run dev`
확인 사항:
- 픽셀 캔버스 우하단에 ▣ 토글 버튼 보임
- 클릭하면 반투명 채팅 오버레이 열림
- 메시지 입력 + Enter → 유저 버블 표시 → 에이전트 에코 응답
- ✕ 버튼으로 오버레이 닫힘
- 픽셀 입력창 (더블라인 테두리, ■□ 아이콘, ▶▶ 전송)

import { useState, useRef, useEffect, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { WSServerMessage } from '@claude-alive/core';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
  streaming?: boolean;
}

export type ChatEventHandler = (msg: WSServerMessage) => void;

interface ChatOverlayProps {
  open: boolean;
  onToggle: () => void;
  onSend?: (message: string) => void;
  chatEventRef?: MutableRefObject<ChatEventHandler | null>;
}

export function ChatOverlay({ open, onToggle, onSend, chatEventRef }: ChatOverlayProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamingMsgIdRef = useRef<string | null>(null);

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

  // Register chat event handler
  useEffect(() => {
    if (!chatEventRef) return;
    chatEventRef.current = (msg: WSServerMessage) => {
      if (msg.type === 'chat:chunk') {
        if (!streamingMsgIdRef.current) {
          // Create new agent message
          const id = crypto.randomUUID();
          streamingMsgIdRef.current = id;
          setMessages(prev => [...prev, {
            id,
            role: 'agent',
            content: msg.text,
            timestamp: Date.now(),
            streaming: true,
          }]);
        } else {
          // Append to existing streaming message
          const sid = streamingMsgIdRef.current;
          setMessages(prev => prev.map(m =>
            m.id === sid ? { ...m, content: m.content + msg.text } : m
          ));
        }
      } else if (msg.type === 'chat:end') {
        const sid = streamingMsgIdRef.current;
        if (sid) {
          setMessages(prev => prev.map(m =>
            m.id === sid ? { ...m, streaming: false } : m
          ));
        }
        streamingMsgIdRef.current = null;
      } else if (msg.type === 'chat:error') {
        streamingMsgIdRef.current = null;
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'agent',
          content: t('chat.error', { message: msg.error }),
          timestamp: Date.now(),
        }]);
      }
    };
    return () => { chatEventRef.current = null; };
  }, [chatEventRef, t]);

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

    if (onSend) {
      onSend(trimmed);
    }
  }, [input, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const isStreaming = streamingMsgIdRef.current !== null;

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
              {msg.streaming && (
                <span style={{ opacity: 0.5, fontFamily: 'var(--font-mono)', fontSize: 11 }}> ▍</span>
              )}
            </div>
          </div>
        ))}

        {/* Streaming indicator when waiting for first chunk */}
        {isStreaming && messages[messages.length - 1]?.role === 'user' && (
          <div style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            padding: '4px 0',
          }}>
            {t('chat.streaming')}
          </div>
        )}
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

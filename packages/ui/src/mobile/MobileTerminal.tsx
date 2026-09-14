import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COLORS, screen, topBar, secondaryButton, input, TYPE, clamp1 } from './styles.ts';
import { PullToRefresh } from './PullToRefresh.tsx';
import { MobileXterm } from './MobileXterm.tsx';
import type { TermFeed } from './termFeed.ts';

export interface MobileTerminalProps {
  title: string;
  /** The checkout this pty runs in, shown under the title. */
  subtitle?: string;
  /** Raw pty bytes and size changes, drained by the emulator. */
  feed: TermFeed;
  /** False until the pty has sent anything, so the pane can say it is connecting. */
  hasOutput: boolean;
  /** False at the `watch` level: the pane renders, the keyboard does not. */
  canType: boolean;
  exited: boolean;
  onBack: () => void;
  onSend: (data: string) => void;
  onKey: (sequence: string) => void;
  /** Re-attach and replay the scrollback — the only refresh a live pty has. */
  onRefresh?: () => void | Promise<void>;
}

/**
 * Keys a phone keyboard has no way to produce, and that an interactive prompt
 * needs constantly: interrupt, escape, completion, history.
 */
const KEYS: ReadonlyArray<{ label: string; sequence: string }> = [
  { label: 'Ctrl-C', sequence: '\x03' },
  { label: 'Esc', sequence: '\x1b' },
  { label: 'Tab', sequence: '\t' },
  { label: '↑', sequence: '\x1b[A' },
  { label: '↓', sequence: '\x1b[B' },
  { label: 'Enter', sequence: '\r' },
];

/**
 * A pty on a phone.
 *
 * Output renders in the same emulator as the desktop (see `MobileXterm`), so a
 * Claude session keeps its layout. Input still goes a line at a time: typing
 * into a character-level emulator with a soft keyboard is worse than useless —
 * "read what it said, answer the prompt, press Ctrl-C" is what a phone is for.
 */
export function MobileTerminal({ title, subtitle, feed, hasOutput, canType, exited, onBack, onSend, onKey, onRefresh }: MobileTerminalProps) {
  const { t } = useTranslation();
  const [line, setLine] = useState('');

  const send = () => {
    const text = line.trim();
    if (!text) return;
    onSend(`${text}\r`);
    setLine('');
  };

  return (
    <div style={screen}>
      <div style={{ ...topBar, alignItems: 'flex-start' }}>
        <button
          onClick={onBack}
          aria-label={t('mobile.back')}
          style={{ background: 'none', border: 'none', color: COLORS.text, fontSize: 22, lineHeight: 1.1, cursor: 'pointer', padding: '0 6px 0 0' }}
        >
          ‹
        </button>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ ...TYPE.title, ...clamp1 }}>{title}</span>
          {subtitle && <span style={{ ...TYPE.meta, ...clamp1, color: COLORS.muted }}>{subtitle}</span>}
        </span>
      </div>

      <PullToRefresh onRefresh={onRefresh} style={{ padding: '8px 4px' }}>
        {!hasOutput && (
          <p style={{ ...TYPE.meta, color: COLORS.muted, margin: '0 8px 8px' }}>{t('mobile.terminalAttaching')}</p>
        )}
        <MobileXterm feed={feed} />
        {exited && (
          <p style={{ ...TYPE.meta, color: 'var(--accent-red)', margin: '12px 8px 0' }}>{t('mobile.terminalGone')}</p>
        )}
      </PullToRefresh>

      {canType ? (
        <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: '8px 12px calc(8px + env(safe-area-inset-bottom))', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8 }}>
            {KEYS.map((key) => (
              <button
                key={key.label}
                onClick={() => onKey(key.sequence)}
                style={{ ...secondaryButton, ...TYPE.button, minHeight: 40, padding: '0 12px', whiteSpace: 'nowrap' }}
              >
                {key.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={line}
              placeholder={t('mobile.terminalInput')}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                // Korean IME: a bare Enter while composing repeats the last syllable.
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) send();
              }}
              style={{ ...input, flex: 1, fontFamily: 'var(--font-mono, monospace)' }}
            />
            <button
              onClick={send}
              style={{ ...secondaryButton, minHeight: 48, background: COLORS.accent, color: 'var(--on-accent)', border: 'none', fontWeight: 600 }}
            >
              {t('mobile.terminalSend')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: '12px 16px', flexShrink: 0 }}>
          <span style={{ ...TYPE.meta, color: COLORS.muted }}>{t('mobile.terminalReadOnly')}</span>
        </div>
      )}
    </div>
  );
}

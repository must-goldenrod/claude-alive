import type { ReactNode } from 'react';
import { radius, text, toneColor, type BadgeTone } from './tokens.ts';

/** Small tinted pill: counts, labels, states. */
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  const color = toneColor[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 22,
        padding: '1px 7px',
        borderRadius: radius.full,
        fontFamily: 'var(--font-mono)',
        fontSize: text.xs,
        fontWeight: 700,
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

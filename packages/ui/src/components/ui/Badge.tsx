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
        // The pill lives in flex rows beside a growing title. Without these
        // flexbox squeezes it narrower than the number it is meant to contain.
        flexShrink: 0,
        whiteSpace: 'nowrap',
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

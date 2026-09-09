import { describe, it, expect } from 'vitest';
import { COLORS } from '../styles.ts';

/** Relative luminance per WCAG, for a `#rrggbb` string. */
function luminance(hex: string): number {
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

const GROUND = '#0d1117';

describe('phone palette', () => {
  it('keeps secondary text legible on the dark ground it always sits on', () => {
    // Every phone screen paints #0d1117. The desktop's #8b949e clears 4.5:1 on a
    // monitor and vanishes on a handset outdoors, so the phone lifts it.
    expect(contrast(COLORS.muted, GROUND)).toBeGreaterThan(7);
  });

  it('records why the border colour must never be used as text', () => {
    // #30363d against #0d1117 is about 1.5:1 — the "로컬" badge shipped like
    // that and was unreadable. This asserts the fact, so the next person
    // reaching for `COLORS.border` as a text colour has the number in front
    // of them rather than discovering it on a phone.
    expect(contrast('#30363d', GROUND)).toBeLessThan(2);
  });
});

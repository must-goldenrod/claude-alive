/**
 * Shared style atoms for the phone layout.
 *
 * The desktop dashboard positions three fixed-width columns and its header
 * controls sit past x=850, which simply do not exist on a 390px screen. Rather
 * than bend that layout with media queries, the phone gets its own small set of
 * screens; these are the tokens they share so they still read as the same app.
 */
import type { CSSProperties } from 'react';

export const COLORS = {
  bg: 'var(--bg-primary, #0d1117)',
  surface: 'var(--bg-secondary, #161b22)',
  border: 'var(--border-default, #30363d)',
  text: 'var(--text-primary, #e6edf3)',
  /**
   * Secondary text, one step brighter than the desktop's `--text-secondary`.
   *
   * A phone is read at arm's length, outdoors, at whatever brightness the
   * screen decided on — and every one of these screens is dark. #8b949e holds
   * up on a monitor and disappears on a handset, so the phone palette lifts it
   * rather than inheriting. `border` is for borders only: at #30363d it is
   * invisible as text, which is exactly what the "로컬" badge looked like.
   */
  muted: '#a9b4c0',
  accent: 'var(--accent-blue, #58a6ff)',
} as const;

/**
 * The phone's type scale.
 *
 * Sizes were being chosen per component, so a label was 11px in one screen and
 * 12px in the next and the same information read as two different kinds of
 * thing. These are the only sizes the phone uses; a component picks a role, not
 * a number.
 *
 * `mono` is reserved for values that are compared or copied — ids, paths,
 * counts — where a proportional font makes two similar strings look alike.
 */
export const FONT_UI = 'var(--font-ui, system-ui)';
export const FONT_MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)';

export const TYPE = {
  /** Screen and card titles. */
  title: { fontSize: 16, fontWeight: 600, lineHeight: 1.4, fontFamily: FONT_UI } as CSSProperties,
  /** Running text: goals, results, conversation. */
  body: { fontSize: 14, lineHeight: 1.6, fontFamily: FONT_UI } as CSSProperties,
  /** Section captions above a panel. */
  label: { fontSize: 11, lineHeight: 1.5, letterSpacing: '0.02em', fontFamily: FONT_UI } as CSSProperties,
  /** Timestamps, counts, ids — anything read rather than prose. */
  meta: { fontSize: 12, lineHeight: 1.5, fontFamily: FONT_MONO } as CSSProperties,
  /** Terminal output and key/value values. */
  code: { fontSize: 12, lineHeight: 1.6, fontFamily: FONT_MONO } as CSSProperties,
  /** Anything tappable. */
  button: { fontSize: 14, fontWeight: 600, fontFamily: FONT_UI } as CSSProperties,
  /** Status pills. */
  badge: { fontSize: 11, lineHeight: 1.6, fontFamily: FONT_UI } as CSSProperties,
} as const;

/** One line, cut with an ellipsis rather than wrapping unpredictably. */
export const clamp1: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

/** Two lines, then cut — for goals and titles that are usually short but never guaranteed. */
export const clamp2: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

export const screen: CSSProperties = {
  // Absolute, not fixed: the shell may put a tab bar above these screens, and a
  // fixed child would sit on top of it.
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: COLORS.bg,
  color: COLORS.text,
  fontFamily: 'var(--font-ui, system-ui)',
};

export const topBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 16px',
  borderBottom: `1px solid ${COLORS.border}`,
  flexShrink: 0,
};

export const body: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 12,
  // Room for the fixed action bar plus the home indicator.
  paddingBottom: 88,
};

export const card: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 12,
  padding: 14,
  marginBottom: 8,
  color: COLORS.text,
  cursor: 'pointer',
};

/** Anything tappable is at least 44px tall — below that a thumb misses it. */
export const primaryButton: CSSProperties = {
  width: '100%',
  minHeight: 48,
  borderRadius: 10,
  border: 'none',
  background: COLORS.accent,
  color: '#0d1117',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
};

export const secondaryButton: CSSProperties = {
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 10,
  border: `1px solid ${COLORS.border}`,
  background: 'transparent',
  color: COLORS.text,
  fontSize: 14,
  cursor: 'pointer',
};

export const actionBar: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
  background: COLORS.bg,
  borderTop: `1px solid ${COLORS.border}`,
  display: 'flex',
  gap: 8,
};

export const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  borderRadius: 10,
  border: `1px solid ${COLORS.border}`,
  background: COLORS.surface,
  color: COLORS.text,
  fontSize: 16, // 16px or iOS Safari zooms the page on focus.
  fontFamily: 'inherit',
};

/**
 * The shape selector uses: the same rounded square as Solve, not a pill.
 * One radius across chips, toggles and buttons keeps the phone reading as the
 * same product as the desktop, where nothing is pill-shaped.
 */
export const chip: CSSProperties = {
  minHeight: 40,
  padding: '0 14px',
  borderRadius: 10,
  cursor: 'pointer',
  fontSize: 13,
  whiteSpace: 'nowrap',
};

export const label: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: COLORS.muted,
  marginBottom: 6,
};

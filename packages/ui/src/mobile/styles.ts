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
  muted: 'var(--text-secondary, #8b949e)',
  accent: 'var(--accent-blue, #58a6ff)',
} as const;

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

export const label: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: COLORS.muted,
  marginBottom: 6,
};

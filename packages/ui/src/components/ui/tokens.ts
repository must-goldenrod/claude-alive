/**
 * Design tokens as TS constants. Components reference these instead of typing
 * `var(--…)` strings, so a renamed token breaks the build rather than silently
 * rendering an unstyled element.
 */
export const space = {
  1: 'var(--space-1)', 2: 'var(--space-2)', 3: 'var(--space-3)',
  4: 'var(--space-4)', 5: 'var(--space-5)', 6: 'var(--space-6)',
} as const;

export const radius = {
  sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)',
  xl: 'var(--radius-xl)', full: 'var(--radius-full)',
} as const;

export const text = {
  xs: 'var(--text-xs)', sm: 'var(--text-sm)', base: 'var(--text-base)',
  lg: 'var(--text-lg)', xl: 'var(--text-xl)',
} as const;

export type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'purple';

export const toneColor: Record<BadgeTone, string> = {
  neutral: 'var(--text-secondary)',
  blue: 'var(--accent-blue)',
  green: 'var(--accent-green)',
  amber: 'var(--accent-amber)',
  red: 'var(--accent-red)',
  purple: 'var(--accent-purple)',
};

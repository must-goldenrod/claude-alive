import type { ReactNode } from 'react';
import { radius, space } from './tokens.ts';

const PADDING = { sm: space[3], md: space[4], lg: space[5] } as const;

/** Bordered surface. The single source of "what a card/panel looks like". */
export function Panel({
  children,
  padding = 'md',
}: {
  children: ReactNode;
  padding?: keyof typeof PADDING;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: radius.lg,
        background: 'var(--bg-secondary)',
        padding: PADDING[padding],
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );
}

import type { RunKind } from '@claude-alive/core';

/**
 * Level markers for the sidebar tree.
 *
 * Indentation alone does not say what a row IS — at a glance a branch and a run
 * look like the same thing one step apart. These give each level a shape, so
 * the hierarchy reads without counting pixels.
 */
export type HierarchyLevel = 'repo' | 'branch' | RunKind;

const PATHS: Record<HierarchyLevel, string> = {
  // Repository: a stack of shelves — the container everything else sits in.
  repo: 'M2 3.5A1.5 1.5 0 0 1 3.5 2h7A1.5 1.5 0 0 1 12 3.5v9L7 10.5 2 12.5v-9Z',
  // Branch: two nodes joined by a fork.
  branch: 'M4 2v6a3 3 0 0 0 3 3h1M4 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm0-7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  // Ticket run: a card with a torn edge.
  ticket: 'M2.5 4h9a.5.5 0 0 1 .5.5V6a1 1 0 0 0 0 2v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V8a1 1 0 0 0 0-2V4.5a.5.5 0 0 1 .5-.5Z',
  // Terminal run: a prompt caret.
  terminal: 'M2 2.5h10v9H2v-9Zm2 2.5 2 2-2 2M7.5 9.5h3',
  // Agent run: a small figure.
  agent: 'M7 7a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 7 7Zm-4 5.5a4 4 0 0 1 8 0',
};

/** Levels whose glyph reads better as an outline than a filled shape. */
const STROKED: ReadonlySet<HierarchyLevel> = new Set(['branch', 'terminal', 'agent']);

export function HierarchyIcon({
  level,
  color = 'currentColor',
  size = 13,
}: {
  level: HierarchyLevel;
  color?: string;
  size?: number;
}) {
  const stroked = STROKED.has(level);
  return (
    <svg
      data-testid={`hierarchy-icon-${level}`}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <path
        d={PATHS[level]}
        fill={stroked ? 'none' : color}
        stroke={stroked ? color : 'none'}
        strokeWidth={stroked ? 1.3 : 0}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

import type { RunKind } from '@claude-alive/core';

/**
 * Level markers for the sidebar tree.
 *
 * Indentation alone does not say what a row IS — at a glance a branch and a run
 * look like the same thing one step apart. These give each level a shape, so
 * the hierarchy reads without counting pixels.
 */
export type HierarchyLevel = 'repo' | 'repo-remote' | 'branch' | RunKind;

const PATHS: Record<HierarchyLevel, string> = {
  // Local repository: a folder on this machine's own disk.
  repo: 'M1.5 4.25A1.25 1.25 0 0 1 2.75 3h2.19c.33 0 .64.13.87.37l.82.8h4.62A1.25 1.25 0 0 1 12.5 5.4v5.35A1.25 1.25 0 0 1 11.25 12h-8.5A1.25 1.25 0 0 1 1.5 10.75v-6.5Z',
  // Remote repository: a rack-mounted host, with its status lamp on the left.
  'repo-remote': 'M2 2.75h10v3H2v-3Zm0 5.5h10v3H2v-3Z',
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

/**
 * Extra strokes drawn over the base shape.
 *
 * The remote host needs its lamps and its uplink to read as a SERVER rather
 * than as two stacked boxes — the one thing that has to be legible at 13px is
 * "this is not on your disk".
 */
const OVERLAY: Partial<Record<HierarchyLevel, string>> = {
  'repo-remote': 'M3.6 4.25h.01M3.6 9.75h.01M9 4.25h1.4M9 9.75h1.4',
};

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
      {OVERLAY[level] && (
        <path
          d={OVERLAY[level]}
          fill="none"
          stroke="var(--bg-primary, #0d1117)"
          strokeWidth={1.4}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

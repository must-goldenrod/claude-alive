/**
 * The fold marker on an expandable row.
 *
 * A single stroked V rather than a filled triangle: at the size a sidebar row
 * can spare, a solid glyph reads as a blob and competes with the level icon
 * beside it. One line has an unmistakable direction and stays quiet.
 *
 * Rotation, not two paths, so collapsing animates and the two states can never
 * drift apart visually.
 */
export function Chevron({
  expanded,
  size = 16,
  color = 'var(--text-secondary)',
}: {
  expanded: boolean;
  size?: number;
  color?: string;
}) {
  return (
    <svg
      data-testid={expanded ? 'chevron-expanded' : 'chevron-collapsed'}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={{
        flexShrink: 0,
        display: 'block',
        // Collapsed points right, expanded points down.
        transform: `rotate(${expanded ? 0 : -90}deg)`,
        transition: 'transform 0.15s ease',
      }}
    >
      <path
        d="M4 6.5 8 10.5 12 6.5"
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

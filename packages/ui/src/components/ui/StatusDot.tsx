import { toneColor, type BadgeTone } from './tokens.ts';

/** 8px state dot. `pulse` marks a live/running run. */
export function StatusDot({ tone, pulse = false }: { tone: BadgeTone; pulse?: boolean }) {
  return (
    <span
      data-testid="status-dot"
      data-tone={tone}
      data-pulse={pulse ? 'true' : 'false'}
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: toneColor[tone],
        flexShrink: 0,
        boxShadow: pulse ? `0 0 0 3px color-mix(in srgb, ${toneColor[tone]} 22%, transparent)` : 'none',
      }}
    />
  );
}

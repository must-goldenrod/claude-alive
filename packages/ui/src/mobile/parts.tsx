import type { ReactNode } from 'react';
import { COLORS } from './styles.ts';

/**
 * The desktop detail modal's building blocks, at phone width.
 *
 * The modal reads as a stack of labelled sections with a monospace meta line;
 * reproducing that shape rather than inventing a phone-specific one means a
 * ticket looks the same wherever it is opened, which is what makes the two
 * views feel like one product.
 */
export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 6, letterSpacing: '0.02em' }}>{label}</div>
      {children}
    </div>
  );
}

export function Panel({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${accent ?? COLORS.border}`,
        borderRadius: 10,
        padding: 12,
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

/** Two-column key/value rows, as the desktop run-info table renders them. */
export function InfoRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <Panel>
      {rows.map(([key, value]) => (
        <div key={key} style={{ display: 'flex', gap: 10, padding: '3px 0', alignItems: 'baseline' }}>
          <span style={{ fontSize: 11, color: COLORS.muted, flex: '0 0 40%', wordBreak: 'keep-all' }}>{key}</span>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-all' }}>{value}</span>
        </div>
      ))}
    </Panel>
  );
}

export function Badge({ text, color, filled }: { text: string; color: string; filled?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        lineHeight: 1.6,
        whiteSpace: 'nowrap',
        border: `1px solid ${color}`,
        background: filled ? color : 'transparent',
        color: filled ? '#0d1117' : color,
      }}
    >
      {text}
    </span>
  );
}

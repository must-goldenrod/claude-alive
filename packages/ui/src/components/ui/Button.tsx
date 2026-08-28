import type { ReactNode } from 'react';
import { radius, text } from './tokens.ts';

type Variant = 'primary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: 'var(--accent-blue)', fg: '#0d1117', border: 'transparent' },
  ghost: { bg: 'transparent', fg: 'var(--text-secondary)', border: 'var(--border-color)' },
  danger: { bg: 'transparent', fg: 'var(--accent-red)', border: 'var(--accent-red)' },
};

export function Button({
  children,
  variant = 'ghost',
  onClick,
  disabled = false,
  type = 'button',
  title,
}: {
  children: ReactNode;
  variant?: Variant;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  const v = VARIANT[variant];
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: radius.md,
        border: `1px solid ${v.border}`,
        background: v.bg,
        color: v.fg,
        fontFamily: 'var(--font-ui)',
        fontSize: text.sm,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background-color var(--dur-fast) ease, transform var(--dur-fast) ease',
      }}
    >
      {children}
    </button>
  );
}

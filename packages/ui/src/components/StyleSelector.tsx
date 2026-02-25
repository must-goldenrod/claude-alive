import type { UIStyle } from '../App.tsx';

interface StyleSelectorProps {
  current: UIStyle;
  onChange: (style: UIStyle) => void;
}

const STYLES: { key: UIStyle; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'pixel', label: 'Pixel Office' },
  { key: 'three-d', label: '3D Battlefield' },
  { key: 'hybrid', label: 'Hybrid' },
];

export function StyleSelector({ current, onChange }: StyleSelectorProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 40,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '0 12px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginRight: 12,
          letterSpacing: '-0.02em',
        }}
      >
        claude-alive
      </span>

      {STYLES.map(({ key, label }) => {
        const active = key === current;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              height: 28,
              padding: '0 10px',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: active ? 600 : 400,
              fontFamily: 'inherit',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: active ? 'var(--bg-card)' : 'transparent',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

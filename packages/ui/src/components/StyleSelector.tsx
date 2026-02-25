import { useTranslation } from 'react-i18next';
import type { UIStyle } from '../App.tsx';

interface StyleSelectorProps {
  current: UIStyle;
  onChange: (style: UIStyle) => void;
}

const STYLE_KEYS: { key: UIStyle; labelKey: string }[] = [
  { key: 'dashboard', labelKey: 'styles.dashboard' },
  { key: 'three-d', labelKey: 'styles.threeDField' },
  { key: 'pixel', labelKey: 'styles.pixel' },
];

export function StyleSelector({ current, onChange }: StyleSelectorProps) {
  const { t, i18n } = useTranslation();
  const isKo = i18n.language?.startsWith('ko');

  const toggleLang = () => {
    i18n.changeLanguage(isKo ? 'en' : 'ko');
  };

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

      {STYLE_KEYS.map(({ key, labelKey }) => {
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
            {t(labelKey)}
          </button>
        );
      })}

      <button
        onClick={toggleLang}
        style={{
          marginLeft: 'auto',
          height: 28,
          padding: '0 10px',
          border: '1px solid var(--border-color)',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'inherit',
          color: 'var(--text-secondary)',
          background: 'transparent',
          transition: 'background 0.15s',
        }}
      >
        {isKo ? 'EN' : '한'}
      </button>
    </div>
  );
}

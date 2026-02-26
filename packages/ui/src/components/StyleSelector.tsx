import { useTranslation } from 'react-i18next';
import type { ViewMode } from '../views/unified/UnifiedView.tsx';

interface StyleSelectorProps {
  current: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const MODE_KEYS: { key: ViewMode; labelKey: string }[] = [
  { key: 'three-d', labelKey: 'styles.threeDField' },
  { key: 'pixel', labelKey: 'styles.pixel' },
  { key: 'bishoujo', labelKey: 'styles.bishoujo' },
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
        height: 44,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 20px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginRight: 20,
          letterSpacing: '-0.02em',
        }}
      >
        claude-alive
      </span>

      {MODE_KEYS.map(({ key, labelKey }) => {
        const active = key === current;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              height: 30,
              padding: '0 14px',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
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

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={toggleLang}
          style={{
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
    </div>
  );
}

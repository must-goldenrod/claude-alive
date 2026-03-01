import { useTranslation } from 'react-i18next';

interface HeaderBarProps {
  onGalleryOpen: () => void;
}

export function HeaderBar({ onGalleryOpen }: HeaderBarProps) {
  const { t, i18n } = useTranslation();
  const isKo = i18n.language?.startsWith('ko');

  const toggleLang = () => {
    i18n.changeLanguage(isKo ? 'en' : 'ko');
  };

  const btnStyle: React.CSSProperties = {
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
          letterSpacing: '-0.02em',
        }}
      >
        claude-alive
      </span>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onGalleryOpen} style={btnStyle}>
          {t('gallery.button')}
        </button>
        <button onClick={toggleLang} style={btnStyle}>
          {isKo ? 'EN' : '한'}
        </button>
      </div>
    </div>
  );
}

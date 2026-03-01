import { useTranslation } from 'react-i18next';
import type { Page } from '../App.tsx';

interface HeaderBarProps {
  page: Page;
  onNavigate: (p: Page) => void;
}

export function HeaderBar({ page, onNavigate }: HeaderBarProps) {
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

  const tabStyle = (active: boolean): React.CSSProperties => ({
    ...btnStyle,
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    borderColor: active ? 'var(--text-primary)' : 'var(--border-color)',
    background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
  });

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
          marginRight: 16,
        }}
      >
        claude-alive
      </span>

      <button onClick={() => onNavigate('dashboard')} style={tabStyle(page === 'dashboard')}>
        Dashboard
      </button>
      <button onClick={() => onNavigate('pixel')} style={tabStyle(page === 'pixel')}>
        {t('pixelOffice.title')}
      </button>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={toggleLang} style={btnStyle}>
          {isKo ? 'EN' : '한'}
        </button>
      </div>
    </div>
  );
}

import { useTranslation } from 'react-i18next';

export function HeaderBar() {
  const { i18n } = useTranslation();
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
        height: 56,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 24px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <span
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
        }}
      >
        claude-alive
      </span>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={toggleLang}
          style={{
            height: 32,
            padding: '0 14px',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            color: 'var(--text-secondary)',
            background: 'transparent',
            transition: 'all 0.2s ease',
          }}
        >
          {isKo ? 'EN' : '\ud55c'}
        </button>
      </div>
    </div>
  );
}

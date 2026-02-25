import { useTranslation } from 'react-i18next';

interface HeaderProps {
  connected: boolean;
  agentCount: number;
}

export function Header({ connected, agentCount }: HeaderProps) {
  const { t, i18n } = useTranslation();
  const isKo = i18n.language?.startsWith('ko');
  const toggleLang = () => i18n.changeLanguage(isKo ? 'en' : 'ko');

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-8 py-4 border-b" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          claude-alive
        </h1>
        <span className="text-sm px-2.5 py-1 rounded" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
          {t('header.dashboard')}
        </span>
      </div>
      <div className="flex items-center gap-5">
        <span className="text-base font-medium" style={{ color: 'var(--text-secondary)' }}>
          {t('header.agentCount', { count: agentCount })}
        </span>
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{
              background: connected ? 'var(--accent-green)' : 'var(--accent-red)',
              boxShadow: connected ? '0 0 8px var(--accent-green)' : '0 0 8px var(--accent-red)',
            }}
          />
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {connected ? t('header.connected') : t('header.disconnected')}
          </span>
        </div>
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
          }}
        >
          {isKo ? 'EN' : '\u97D3'}
        </button>
      </div>
    </header>
  );
}

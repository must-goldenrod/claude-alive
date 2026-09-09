import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { onAuthFailure, storeToken } from '../lib/auth.ts';

/**
 * Asks for a token when the server answers 401.
 *
 * A remote-mode server refuses every route without one, so without this the
 * dashboard is a blank screen with console errors. Submitting reloads rather
 * than retrying in place: every view fetched once already and the WebSocket
 * carries the token in its handshake, so a reload is the honest way to redo
 * both with the new credential.
 */
export function TokenGate() {
  const { t } = useTranslation();
  const [needed, setNeeded] = useState(false);
  const [value, setValue] = useState('');

  useEffect(() => onAuthFailure(() => setNeeded(true)), []);

  if (!needed) return null;

  const submit = () => {
    const token = value.trim();
    if (!token) return;
    storeToken(token);
    window.location.reload();
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(13, 17, 23, 0.92)', fontFamily: 'var(--font-ui)',
      }}
    >
      <div style={{ width: 420, maxWidth: '90vw', padding: 24, borderRadius: 12, background: 'var(--bg-secondary, #161b22)', border: '1px solid var(--border-default, #30363d)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16, color: 'var(--text-primary, #e6edf3)' }}>{t('auth.title')}</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary, #8b949e)' }}>{t('auth.body')}</p>
        <input
          type="password"
          value={value}
          autoFocus
          placeholder={t('auth.placeholder')}
          onChange={(e) => setValue(e.target.value)}
          // Composition guard is unnecessary for a token field, but Enter to
          // submit is what anyone pasting a credential expects.
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--border-default, #30363d)', background: 'var(--bg-primary, #0d1117)',
            color: 'var(--text-primary, #e6edf3)', fontFamily: 'var(--font-mono)', fontSize: 13,
          }}
        />
        <button
          onClick={submit}
          style={{
            marginTop: 12, width: '100%', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
            border: 'none', background: 'var(--accent-blue, #58a6ff)', color: '#0d1117', fontSize: 13, fontWeight: 600,
          }}
        >
          {t('auth.submit')}
        </button>
      </div>
    </div>
  );
}

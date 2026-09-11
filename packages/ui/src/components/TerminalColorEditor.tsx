import { useTranslation } from 'react-i18next';
import {
  TERMINAL_COLOR_KEYS,
  resolveTerminalTheme,
  type TerminalColorKey,
  type TerminalColorOverrides,
} from '../services/settings';

interface TerminalColorEditorProps {
  themeId: string;
  overrides: TerminalColorOverrides;
  onChange: (next: TerminalColorOverrides) => void;
}

/**
 * Per-slot colour pickers layered on the selected preset. Shows the effective colour
 * for every slot; an overridden slot gets a dot and can be reverted individually.
 */
export function TerminalColorEditor({ themeId, overrides, onChange }: TerminalColorEditorProps) {
  const { t } = useTranslation();
  const theme = resolveTerminalTheme(themeId, overrides);
  const hasOverrides = Object.keys(overrides).length > 0;

  const setSlot = (key: TerminalColorKey, color: string) => onChange({ ...overrides, [key]: color });
  const clearSlot = (key: TerminalColorKey) =>
    onChange(Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== key)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <TerminalPreview themeId={themeId} overrides={overrides} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
        {TERMINAL_COLOR_KEYS.map(key => {
          const overridden = key in overrides;
          const value = theme[key];
          return (
            <div
              key={key}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
                borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 12,
              }}
            >
              <input
                type="color"
                aria-label={t(`settings.terminal.colors.${key}`)}
                value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
                onChange={(e) => setSlot(key, e.target.value)}
                style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
              />
              <span style={{ flex: 1, color: 'var(--text-primary)' }}>{t(`settings.terminal.colors.${key}`)}</span>
              {overridden && (
                <button
                  onClick={() => clearSlot(key)}
                  title={t('settings.terminal.colorRevert')}
                  aria-label={t('settings.terminal.colorRevert')}
                  style={{ border: 'none', background: 'none', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: 12 }}
                >
                  ↺
                </button>
              )}
            </div>
          );
        })}
      </div>
      {hasOverrides && (
        <button
          onClick={() => onChange({})}
          style={{
            alignSelf: 'flex-start', padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
            border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)',
          }}
        >
          {t('settings.terminal.colorResetAll')}
        </button>
      )}
    </div>
  );
}

const PREVIEW_KEYS: TerminalColorKey[] = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];

function TerminalPreview({ themeId, overrides }: Omit<TerminalColorEditorProps, 'onChange'>) {
  const { t } = useTranslation();
  const theme = resolveTerminalTheme(themeId, overrides);
  return (
    <div
      style={{
        padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-color)',
        background: theme.background === 'transparent' ? 'var(--bg-primary)' : theme.background,
        color: theme.foreground, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6,
      }}
    >
      <div>{t('settings.terminal.previewPrompt')}</div>
      <div>
        {PREVIEW_KEYS.map(key => (
          <span key={key} style={{ color: theme[key], marginRight: 8 }}>{t(`settings.terminal.colors.${key}`)}</span>
        ))}
      </div>
      <div>
        <span style={{ background: theme.cursor, color: theme.cursorAccent }}>&nbsp;</span>
      </div>
    </div>
  );
}

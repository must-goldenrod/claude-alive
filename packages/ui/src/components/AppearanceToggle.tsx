import { useTranslation } from 'react-i18next';
import { useSettings, setSettings, APPEARANCE_MODES, type AppearanceMode } from '../services/settings';

const ICONS: Record<AppearanceMode, string> = { dark: '☾', light: '☀', system: '◐' };

/** Cycles dark → light → system. The title names the current mode and the next one. */
export function AppearanceToggle({ style }: { style: React.CSSProperties }) {
  const { t } = useTranslation();
  const mode = useSettings().appearance.mode;
  const next = APPEARANCE_MODES[(APPEARANCE_MODES.indexOf(mode) + 1) % APPEARANCE_MODES.length]!;
  const label = t('appearance.toggle', {
    current: t(`appearance.${mode}`),
    next: t(`appearance.${next}`),
  });

  return (
    <button
      onClick={() => setSettings(prev => ({ ...prev, appearance: { mode: next } }))}
      title={label}
      aria-label={label}
      style={style}
    >
      <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>{ICONS[mode]}</span>
    </button>
  );
}

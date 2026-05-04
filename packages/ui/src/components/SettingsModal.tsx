import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  useSettings,
  setSettings,
  TERMINAL_THEMES,
  FONT_PRESETS,
  DEFAULT_SETTINGS,
  type CursorStyle,
} from '../services/settings';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const settings = useSettings();
  const [tab, setTab] = useState<'sound' | 'terminal' | 'alerts'>('sound');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 94vw)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 14,
          overflow: 'hidden',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-ui)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <GearIcon size={18} />
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {t('settings.title', { defaultValue: 'Settings' })}
            </span>
          </div>
          <button
            onClick={onClose}
            title={t('settings.close', { defaultValue: 'Close' })}
            style={iconBtnStyle}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '8px 14px 0',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <TabButton
            active={tab === 'sound'}
            onClick={() => setTab('sound')}
            label={t('settings.tabs.sound', { defaultValue: 'Sound' })}
          />
          <TabButton
            active={tab === 'terminal'}
            onClick={() => setTab('terminal')}
            label={t('settings.tabs.terminal', { defaultValue: 'Terminal' })}
          />
          <TabButton
            active={tab === 'alerts'}
            onClick={() => setTab('alerts')}
            label={t('settings.tabs.alerts', { defaultValue: 'Alerts' })}
          />
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {tab === 'sound' && (
            <>
              <SoundSection
                titleKey="settings.sound.completion"
                defaultTitle="Completion sound"
                enabled={settings.sound.completion.enabled}
                volume={settings.sound.completion.volume}
                onToggle={(enabled) =>
                  setSettings(prev => ({
                    ...prev,
                    sound: { ...prev.sound, completion: { ...prev.sound.completion, enabled } },
                  }))
                }
                onVolume={(volume) =>
                  setSettings(prev => ({
                    ...prev,
                    sound: { ...prev.sound, completion: { ...prev.sound.completion, volume } },
                  }))
                }
                onTest={() => {
                  const audio = new Audio('/assets/complete_sound.mp3');
                  audio.volume = settings.sound.completion.volume;
                  audio.play().catch(() => {});
                }}
              />
              <SoundSection
                titleKey="settings.sound.error"
                defaultTitle="Error sound"
                enabled={settings.sound.error.enabled}
                volume={settings.sound.error.volume}
                onToggle={(enabled) =>
                  setSettings(prev => ({
                    ...prev,
                    sound: { ...prev.sound, error: { ...prev.sound.error, enabled } },
                  }))
                }
                onVolume={(volume) =>
                  setSettings(prev => ({
                    ...prev,
                    sound: { ...prev.sound, error: { ...prev.sound.error, volume } },
                  }))
                }
                onTest={() => {
                  const audio = new Audio('/assets/error_sound.mp3');
                  audio.volume = settings.sound.error.volume;
                  audio.play().catch(() => {});
                }}
              />
            </>
          )}

          {tab === 'terminal' && (
            <>
              <FieldRow label={t('settings.terminal.theme', { defaultValue: 'Color theme' })}>
                <SelectButtons
                  value={settings.terminal.themeId}
                  onChange={(themeId) =>
                    setSettings(prev => ({ ...prev, terminal: { ...prev.terminal, themeId } }))
                  }
                  options={TERMINAL_THEMES.map(t => ({
                    value: t.id,
                    label: t.label,
                    swatch: t.theme.background === 'transparent' ? undefined : t.theme.background,
                    accent: t.theme.cursor,
                  }))}
                />
              </FieldRow>

              <FieldRow label={t('settings.terminal.font', { defaultValue: 'Font family' })}>
                <SelectDropdown
                  value={settings.terminal.fontFamilyId}
                  onChange={(fontFamilyId) =>
                    setSettings(prev => ({ ...prev, terminal: { ...prev.terminal, fontFamilyId } }))
                  }
                  options={FONT_PRESETS.map(f => ({ value: f.id, label: f.label }))}
                />
              </FieldRow>

              <SliderRow
                label={t('settings.terminal.fontSize', { defaultValue: 'Font size' })}
                value={settings.terminal.fontSize}
                min={10} max={22} step={1} unit="px"
                onChange={(fontSize) =>
                  setSettings(prev => ({ ...prev, terminal: { ...prev.terminal, fontSize } }))
                }
              />

              <SliderRow
                label={t('settings.terminal.lineHeight', { defaultValue: 'Line spacing' })}
                value={settings.terminal.lineHeight}
                min={1.0} max={2.0} step={0.05} unit="×"
                onChange={(lineHeight) =>
                  setSettings(prev => ({ ...prev, terminal: { ...prev.terminal, lineHeight } }))
                }
              />

              <SliderRow
                label={t('settings.terminal.letterSpacing', { defaultValue: 'Letter spacing' })}
                value={settings.terminal.letterSpacing}
                min={-2} max={4} step={0.5} unit="px"
                onChange={(letterSpacing) =>
                  setSettings(prev => ({ ...prev, terminal: { ...prev.terminal, letterSpacing } }))
                }
              />

              <FieldRow label={t('settings.terminal.cursorStyle', { defaultValue: 'Cursor style' })}>
                <SelectButtons
                  value={settings.terminal.cursorStyle}
                  onChange={(cursorStyle) =>
                    setSettings(prev => ({
                      ...prev,
                      terminal: { ...prev.terminal, cursorStyle: cursorStyle as CursorStyle },
                    }))
                  }
                  options={[
                    { value: 'block', label: t('settings.terminal.cursorBlock', { defaultValue: 'Block' }) },
                    { value: 'bar', label: t('settings.terminal.cursorBar', { defaultValue: 'Bar' }) },
                    { value: 'underline', label: t('settings.terminal.cursorUnderline', { defaultValue: 'Underline' }) },
                  ]}
                />
              </FieldRow>

              <ToggleRow
                label={t('settings.terminal.cursorBlink', { defaultValue: 'Cursor blink' })}
                checked={settings.terminal.cursorBlink}
                onChange={(cursorBlink) =>
                  setSettings(prev => ({ ...prev, terminal: { ...prev.terminal, cursorBlink } }))
                }
              />

              {settings.terminal.cursorStyle === 'bar' && (
                <SliderRow
                  label={t('settings.terminal.cursorWidth', { defaultValue: 'Cursor width' })}
                  value={settings.terminal.cursorWidth}
                  min={1} max={4} step={1} unit="px"
                  onChange={(cursorWidth) =>
                    setSettings(prev => ({ ...prev, terminal: { ...prev.terminal, cursorWidth } }))
                  }
                />
              )}

              <SliderRow
                label={t('settings.terminal.paddingX', { defaultValue: 'Horizontal padding' })}
                value={settings.terminal.paddingX}
                min={0} max={32} step={1} unit="px"
                onChange={(paddingX) =>
                  setSettings(prev => ({ ...prev, terminal: { ...prev.terminal, paddingX } }))
                }
              />

              <SliderRow
                label={t('settings.terminal.paddingY', { defaultValue: 'Vertical padding' })}
                value={settings.terminal.paddingY}
                min={0} max={32} step={1} unit="px"
                onChange={(paddingY) =>
                  setSettings(prev => ({ ...prev, terminal: { ...prev.terminal, paddingY } }))
                }
              />

              <SliderRow
                label={t('settings.terminal.scrollback', { defaultValue: 'Scrollback buffer' })}
                value={settings.terminal.scrollback}
                min={1000} max={50000} step={1000} unit={t('settings.terminal.lines', { defaultValue: 'lines' })}
                onChange={(scrollback) =>
                  setSettings(prev => ({ ...prev, terminal: { ...prev.terminal, scrollback } }))
                }
              />
            </>
          )}

          {tab === 'alerts' && (
            <>
              <AlertSection
                titleKey="settings.alerts.cpu.title"
                defaultTitle="CPU usage alert"
                config={settings.alerts.cpu}
                onToggleEnabled={(enabled) =>
                  setSettings(prev => ({
                    ...prev,
                    alerts: { ...prev.alerts, cpu: { ...prev.alerts.cpu, enabled } },
                  }))
                }
                onThreshold={(thresholdPct) =>
                  setSettings(prev => ({
                    ...prev,
                    alerts: { ...prev.alerts, cpu: { ...prev.alerts.cpu, thresholdPct } },
                  }))
                }
                onToggleSound={(soundEnabled) =>
                  setSettings(prev => ({
                    ...prev,
                    alerts: { ...prev.alerts, cpu: { ...prev.alerts.cpu, soundEnabled } },
                  }))
                }
              />
              <AlertSection
                titleKey="settings.alerts.memory.title"
                defaultTitle="Memory usage alert"
                config={settings.alerts.memory}
                onToggleEnabled={(enabled) =>
                  setSettings(prev => ({
                    ...prev,
                    alerts: { ...prev.alerts, memory: { ...prev.alerts.memory, enabled } },
                  }))
                }
                onThreshold={(thresholdPct) =>
                  setSettings(prev => ({
                    ...prev,
                    alerts: { ...prev.alerts, memory: { ...prev.alerts.memory, thresholdPct } },
                  }))
                }
                onToggleSound={(soundEnabled) =>
                  setSettings(prev => ({
                    ...prev,
                    alerts: { ...prev.alerts, memory: { ...prev.alerts.memory, soundEnabled } },
                  }))
                }
              />
              <SliderRow
                label={t('settings.alerts.sustain', { defaultValue: 'Sustain time before firing' })}
                value={settings.alerts.sustainSeconds}
                min={1} max={30} step={1} unit={t('settings.alerts.seconds', { defaultValue: 's' })}
                onChange={(sustainSeconds) =>
                  setSettings(prev => ({ ...prev, alerts: { ...prev.alerts, sustainSeconds } }))
                }
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <button
            onClick={() => setSettings(() => DEFAULT_SETTINGS)}
            style={ghostBtnStyle}
            title={t('settings.resetTooltip', { defaultValue: 'Restore defaults' })}
          >
            {t('settings.reset', { defaultValue: 'Reset to defaults' })}
          </button>
          <button onClick={onClose} style={primaryBtnStyle}>
            {t('settings.done', { defaultValue: 'Done' })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent-blue)' : '2px solid transparent',
        color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        transition: 'all 0.15s ease',
      }}
    >
      {label}
    </button>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  );
}

function SoundSection({
  titleKey,
  defaultTitle,
  enabled,
  volume,
  onToggle,
  onVolume,
  onTest,
}: {
  titleKey: string;
  defaultTitle: string;
  enabled: boolean;
  volume: number;
  onToggle: (v: boolean) => void;
  onVolume: (v: number) => void;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        padding: 14,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid var(--border-color)',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {t(titleKey + '.title', { defaultValue: defaultTitle })}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={onTest} style={ghostBtnStyle} disabled={!enabled} title={t('settings.sound.test', { defaultValue: 'Play test sound' })}>
            ▶ {t('settings.sound.test', { defaultValue: 'Test' })}
          </button>
          <Switch checked={enabled} onChange={onToggle} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: enabled ? 1 : 0.45 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 48 }}>
          {t('settings.sound.volume', { defaultValue: 'Volume' })}
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          disabled={!enabled}
          onChange={(e) => onVolume(Number(e.target.value))}
          style={rangeStyle}
        />
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
          {Math.round(volume * 100)}%
        </span>
      </div>
    </div>
  );
}

function AlertSection({
  titleKey,
  defaultTitle,
  config,
  onToggleEnabled,
  onThreshold,
  onToggleSound,
}: {
  titleKey: string;
  defaultTitle: string;
  config: { enabled: boolean; thresholdPct: number; soundEnabled: boolean };
  onToggleEnabled: (v: boolean) => void;
  onThreshold: (v: number) => void;
  onToggleSound: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        padding: 14,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid var(--border-color)',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {t(titleKey, { defaultValue: defaultTitle })}
        </span>
        <Switch checked={config.enabled} onChange={onToggleEnabled} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: config.enabled ? 1 : 0.45 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 64 }}>
          {t('settings.alerts.threshold', { defaultValue: 'Threshold' })}
        </span>
        <input
          type="range"
          min={50}
          max={99}
          step={1}
          value={config.thresholdPct}
          disabled={!config.enabled}
          onChange={(e) => onThreshold(Number(e.target.value))}
          style={rangeStyle}
        />
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
          {config.thresholdPct}%
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: config.enabled ? 1 : 0.45,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {t('settings.alerts.soundEnabled', { defaultValue: 'Play sound on alert' })}
        </span>
        <Switch checked={config.soundEnabled} onChange={onToggleSound} />
      </div>
    </div>
  );
}

function SliderRow({
  label, value, min, max, step, unit, onChange,
}: {
  label: string;
  value: number;
  min: number; max: number; step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <FieldRow label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={rangeStyle}
        />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 70, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
          {Number.isInteger(step) ? value : value.toFixed(2)} {unit}
        </span>
      </div>
    </FieldRow>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 0',
      }}
    >
      <span style={{ fontSize: 13 }}>{label}</span>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 12,
        border: '1px solid ' + (checked ? 'var(--accent-blue)' : 'var(--border-color)'),
        background: checked ? 'rgba(88,166,255,0.25)' : 'rgba(255,255,255,0.04)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        padding: 0,
        flexShrink: 0,
      }}
      role="switch"
      aria-checked={checked}
    >
      <span
        style={{
          position: 'absolute',
          top: 1,
          left: checked ? 17 : 1,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: checked ? 'var(--accent-blue)' : 'var(--text-secondary)',
          transition: 'all 0.15s ease',
        }}
      />
    </button>
  );
}

function SelectButtons<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; swatch?: string; accent?: string }>;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(opt => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid ' + (selected ? 'var(--accent-blue)' : 'var(--border-color)'),
              background: selected ? 'rgba(88,166,255,0.12)' : 'rgba(255,255,255,0.02)',
              color: selected ? 'var(--accent-blue)' : 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: selected ? 600 : 500,
              transition: 'all 0.15s ease',
            }}
          >
            {opt.swatch && (
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: opt.swatch,
                  border: '1px solid rgba(255,255,255,0.1)',
                  display: 'inline-block',
                }}
              />
            )}
            {opt.accent && !opt.swatch && (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: opt.accent,
                  display: 'inline-block',
                }}
              />
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SelectDropdown({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '8px 10px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        color: 'var(--text-primary)',
        fontSize: 13,
        fontFamily: 'inherit',
        outline: 'none',
        cursor: 'pointer',
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value} style={{ background: 'var(--bg-secondary)' }}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ── Inline gear icon (used by header & modal) ─────────────────────────────

export function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ── Shared inline styles ───────────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 13,
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
  transition: 'all 0.15s ease',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '7px 16px',
  background: 'var(--accent-blue)',
  border: '1px solid var(--accent-blue)',
  borderRadius: 8,
  color: '#0d1117',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
};

const rangeStyle: React.CSSProperties = {
  flex: 1,
  height: 4,
  accentColor: 'var(--accent-blue)',
  cursor: 'pointer',
};

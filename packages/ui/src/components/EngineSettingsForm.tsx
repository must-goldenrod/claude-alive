import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketEngine, TicketRunPreset } from '@claude-alive/core';
import { RUN_PRESET_IDS, RUN_PRESET_PREVIEW, runPresetLabelKey } from '../views/tickets/runPresets.ts';
import {
  fetchGatewayModels,
  loadEngineSettings,
  saveEngineSettings,
  useEngineSettings,
} from '../services/engineSettings.ts';
import { GATEWAY_CHANGED_EVENT } from './GatewaySettingsForm.tsx';

interface EngineSettingsFormProps {
  /** Load when the settings tab that hosts it opens. */
  active: boolean;
}

/**
 * Engine switch: run new tickets and Claude terminals on the Claude login or on
 * the LLM gateway, and pick the gateway model for each run preset. Applies to the
 * next ticket/terminal without a restart; running and existing tickets keep the
 * engine they were created with.
 */
export function EngineSettingsForm({ active }: EngineSettingsFormProps) {
  const { t } = useTranslation();
  const engine = useEngineSettings();
  const [draftEngine, setDraftEngine] = useState<TicketEngine>('claude');
  const [draftModels, setDraftModels] = useState<Record<TicketRunPreset, string> | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!active) return;
    void loadEngineSettings();
    void fetchGatewayModels().then(setModels);
    const onGateway = () => {
      void loadEngineSettings();
      void fetchGatewayModels().then(setModels);
    };
    window.addEventListener(GATEWAY_CHANGED_EVENT, onGateway);
    return () => window.removeEventListener(GATEWAY_CHANGED_EVENT, onGateway);
  }, [active]);

  // Follow the stored settings (including a save from another dashboard).
  useEffect(() => {
    if (!engine) return;
    setDraftEngine(engine.settings.engine);
    setDraftModels({ ...engine.settings.presetModels });
  }, [engine]);

  if (!engine || !draftModels) {
    return (
      <div data-testid="engine-settings" style={cardStyle}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.backend.engine.title')}</span>
        <div style={hintStyle}>{t('settings.backend.engine.unavailable')}</div>
      </div>
    );
  }

  const dirty =
    draftEngine !== engine.settings.engine ||
    RUN_PRESET_IDS.some((id) => draftModels[id] !== engine.settings.presetModels[id]);
  const gatewayBlocked = draftEngine === 'gateway' && !engine.gatewayConfigured;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await saveEngineSettings({ engine: draftEngine, presetModels: draftModels });
      setMessage(
        result.ok
          ? { kind: 'ok', text: t('settings.backend.engine.saved') }
          : {
              kind: 'error',
              text: result.status === 403 ? t('settings.backend.engine.localOnly') : result.error,
            },
      );
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="engine-settings" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.backend.engine.title')}</span>
        <span data-testid="engine-current" style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-blue)' }}>
          {t(`settings.backend.engine.option.${engine.settings.engine}`)}
        </span>
      </div>
      <div style={hintStyle}>{t('settings.backend.engine.hint')}</div>

      <div role="radiogroup" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['claude', 'gateway'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={draftEngine === id}
            data-testid={`engine-option-${id}`}
            style={chipStyle(draftEngine === id)}
            onClick={() => setDraftEngine(id)}
          >
            {t(`settings.backend.engine.option.${id}`)}
          </button>
        ))}
      </div>
      {gatewayBlocked && (
        <div role="alert" style={{ ...hintStyle, color: 'var(--accent-orange, #d29922)' }}>
          {t('settings.backend.engine.needsGateway')}
        </div>
      )}

      <div style={labelStyle}>{t('settings.backend.engine.presetModels')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, auto) 1fr', gap: '6px 10px', alignItems: 'center' }}>
        {RUN_PRESET_IDS.map((id) => {
          const current = draftModels[id];
          const options = models.includes(current) ? models : [current, ...models];
          return (
            <PresetModelRow
              key={id}
              label={`${t(runPresetLabelKey(id))} · ${RUN_PRESET_PREVIEW[id].effort}`}
              id={id}
              value={current}
              options={options}
              onChange={(model) => setDraftModels((prev) => (prev ? { ...prev, [id]: model } : prev))}
            />
          );
        })}
      </div>
      <div style={hintStyle}>{t('settings.backend.engine.presetModelsHint')}</div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          data-testid="engine-save"
          style={primaryBtn}
          disabled={!dirty || busy || gatewayBlocked}
          onClick={() => void save()}
        >
          {busy ? t('settings.backend.engine.saving') : t('settings.backend.engine.save')}
        </button>
      </div>
      {message && (
        <div role="status" style={{ ...hintStyle, color: message.kind === 'ok' ? 'var(--accent-green, #3fb950)' : 'var(--accent-red, #f85149)' }}>
          {message.text}
        </div>
      )}
    </div>
  );
}

interface PresetModelRowProps {
  label: string;
  id: TicketRunPreset;
  value: string;
  options: string[];
  onChange: (model: string) => void;
}

function PresetModelRow({ label, id, value, options, onChange }: PresetModelRowProps) {
  return (
    <>
      <label htmlFor={`engine-model-${id}`} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</label>
      <select id={`engine-model-${id}`} style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </>
  );
}

const cardStyle: React.CSSProperties = {
  padding: 14,
  background: 'var(--surface-1)',
  border: '1px solid var(--border-color)',
  borderRadius: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const hintStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 };
const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 };
const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
};
const primaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  background: 'var(--accent-blue)',
  border: '1px solid var(--accent-blue)',
  borderRadius: 8,
  color: 'var(--on-accent)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};
function chipStyle(selected: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    borderRadius: 999,
    fontSize: 12,
    cursor: 'pointer',
    border: `1px solid ${selected ? 'var(--accent-blue)' : 'var(--border-color)'}`,
    background: selected ? 'rgba(88, 166, 255, 0.14)' : 'transparent',
    color: selected ? 'var(--accent-blue)' : 'var(--text-secondary)',
  };
}

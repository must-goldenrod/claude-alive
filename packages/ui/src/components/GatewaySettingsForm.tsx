import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

/** Fired after the gateway changes, so the backend list re-reads its cards. */
export const GATEWAY_CHANGED_EVENT = 'claude-alive:gateway-changed';

export interface GatewayState {
  baseUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
  defaultModel: string | null;
  hasModelsFile: boolean;
  active: boolean;
}

interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  needsKey: boolean;
}

/** Any OpenAI-compatible endpoint works; these only prefill the URL. Base URLs exclude `/v1`. */
export const GATEWAY_PROVIDERS: Provider[] = [
  { id: 'litellm', label: 'LiteLLM', baseUrl: 'http://localhost:4000', needsKey: true },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api', needsKey: true },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434', needsKey: false },
  { id: 'custom', label: 'Custom', baseUrl: '', needsKey: false },
];

type TestResult = { ok: true; models: string[] } | { ok: false; error: string };

async function postJson<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

interface GatewaySettingsFormProps {
  /** Load when the settings tab that hosts it opens. */
  active: boolean;
}

/**
 * Connect an OpenAI-compatible gateway (LiteLLM, OpenRouter, Ollama, vLLM…) for
 * sub-agent delegation and review panels. The server
 * writes ~/.claude-alive/.env (0600) and models.json and applies it without a restart.
 * The stored key never comes back to the browser — only its last four characters.
 */
export function GatewaySettingsForm({ active }: GatewaySettingsFormProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<GatewayState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [test, setTest] = useState<TestResult | null>(null);
  const [defaultModel, setDefaultModel] = useState('');
  const [writeModels, setWriteModels] = useState(true);
  const [busy, setBusy] = useState<'test' | 'save' | 'disconnect' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/api/settings/gateway`);
      if (res.status === 403) {
        setLoadError(t('settings.backend.gateway.localOnly'));
        return;
      }
      if (!res.ok) {
        setLoadError(t('settings.backend.gateway.unavailable'));
        return;
      }
      const data = (await res.json()) as GatewayState;
      setState(data);
      setBaseUrl(data.baseUrl ?? '');
      setDefaultModel(data.defaultModel ?? '');
    } catch {
      setLoadError(t('settings.backend.gateway.unavailable'));
    }
  }, [t]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const runTest = async () => {
    setBusy('test');
    setMessage(null);
    try {
      const { data } = await postJson<{ ok: boolean; models?: string[]; error?: string }>(
        '/api/settings/gateway/test',
        { baseUrl: baseUrl.trim(), ...(apiKey ? { apiKey } : {}) },
      );
      if (data.ok) {
        const models = data.models ?? [];
        setTest({ ok: true, models });
        if (!models.includes(defaultModel)) setDefaultModel(models[0] ?? '');
      } else {
        setTest({ ok: false, error: data.error ?? t('settings.backend.gateway.testFailed') });
      }
    } catch (error) {
      setTest({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (disconnect: boolean) => {
    setBusy(disconnect ? 'disconnect' : 'save');
    setMessage(null);
    try {
      const body = disconnect
        ? { baseUrl: '', apiKey: '' }
        : {
            baseUrl: baseUrl.trim(),
            ...(apiKey ? { apiKey } : {}),
            ...(defaultModel ? { defaultModel } : {}),
            writeModels,
          };
      const { status, data } = await postJson<GatewayState & { error?: string; modelsError?: string }>('/api/settings/gateway', body);
      if (status !== 200) {
        setMessage({ kind: 'error', text: data.error ?? t('settings.backend.gateway.saveFailed') });
        return;
      }
      setState(data);
      setApiKey('');
      if (disconnect) {
        setBaseUrl('');
        setTest(null);
      }
      setMessage(
        data.modelsError
          ? { kind: 'error', text: t('settings.backend.gateway.savedWithoutModels', { error: data.modelsError }) }
          : { kind: 'ok', text: t(disconnect ? 'settings.backend.gateway.disconnected' : 'settings.backend.gateway.saved') },
      );
      window.dispatchEvent(new CustomEvent(GATEWAY_CHANGED_EVENT));
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const connected = Boolean(state?.active);

  return (
    <div data-testid="gateway-settings" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.backend.gateway.title')}</span>
        <span
          data-testid="gateway-status"
          style={{ fontSize: 11, fontWeight: 600, color: connected ? 'var(--accent-green, #3fb950)' : 'var(--text-secondary)' }}
        >
          {connected ? t('settings.backend.gateway.statusConnected') : t('settings.backend.gateway.statusOff')}
        </span>
      </div>
      <div style={hintStyle}>{t('settings.backend.gateway.hint')}</div>

      {loadError ? (
        <div role="alert" style={{ ...hintStyle, color: 'var(--accent-orange, #d29922)' }}>{loadError}</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {GATEWAY_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                style={chipStyle(p.baseUrl !== '' && p.baseUrl === baseUrl.trim())}
                onClick={() => {
                  setBaseUrl(p.baseUrl);
                  setTest(null);
                }}
              >
                {p.id === 'custom' ? t('settings.backend.gateway.custom') : p.label}
              </button>
            ))}
          </div>

          <label style={labelStyle} htmlFor="gateway-base-url">{t('settings.backend.gateway.baseUrl')}</label>
          <input
            id="gateway-base-url"
            style={inputStyle}
            value={baseUrl}
            placeholder={GATEWAY_PROVIDERS[0]!.baseUrl}
            spellCheck={false}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setTest(null);
            }}
          />

          <label style={labelStyle} htmlFor="gateway-api-key">{t('settings.backend.gateway.apiKey')}</label>
          <input
            id="gateway-api-key"
            type="password"
            autoComplete="off"
            style={inputStyle}
            value={apiKey}
            placeholder={
              state?.hasKey
                ? t('settings.backend.gateway.apiKeyKeep', { hint: state.keyHint ?? '' })
                : t('settings.backend.gateway.apiKeyOptional')
            }
            onChange={(e) => setApiKey(e.target.value)}
          />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={ghostBtn} disabled={!baseUrl.trim() || busy !== null} onClick={() => void runTest()}>
              {busy === 'test' ? t('settings.backend.gateway.testing') : t('settings.backend.gateway.test')}
            </button>
            {test?.ok && (
              <span data-testid="gateway-test-result" style={{ ...hintStyle, color: 'var(--accent-green, #3fb950)' }}>
                {t('settings.backend.gateway.modelsFound', { count: test.models.length })}
              </span>
            )}
            {test && !test.ok && (
              <span data-testid="gateway-test-result" style={{ ...hintStyle, color: 'var(--accent-red, #f85149)' }}>
                {test.error}
              </span>
            )}
          </div>

          {test?.ok && test.models.length > 0 && (
            <>
              <label style={labelStyle} htmlFor="gateway-default-model">{t('settings.backend.gateway.defaultModel')}</label>
              <select
                id="gateway-default-model"
                style={inputStyle}
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
              >
                {test.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <label style={{ ...hintStyle, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  id="gateway-write-models"
                  type="checkbox"
                  checked={writeModels}
                  onChange={(e) => setWriteModels(e.target.checked)}
                />
                {t('settings.backend.gateway.writeModels')}
              </label>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {state?.baseUrl && (
              <button type="button" style={ghostBtn} disabled={busy !== null} onClick={() => void save(true)}>
                {t('settings.backend.gateway.disconnect')}
              </button>
            )}
            <button type="button" style={primaryBtn} disabled={!baseUrl.trim() || busy !== null} onClick={() => void save(false)}>
              {busy === 'save' ? t('settings.backend.gateway.saving') : t('settings.backend.gateway.save')}
            </button>
          </div>

          {message && (
            <div role="status" style={{ ...hintStyle, color: message.kind === 'ok' ? 'var(--accent-green, #3fb950)' : 'var(--accent-red, #f85149)' }}>
              {message.text}
            </div>
          )}
        </>
      )}
    </div>
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
const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: -4 };
const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
};
const ghostBtn: React.CSSProperties = {
  padding: '6px 12px',
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
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
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 11,
    cursor: 'pointer',
    border: `1px solid ${selected ? 'var(--accent-blue)' : 'var(--border-color)'}`,
    background: selected ? 'rgba(88, 166, 255, 0.14)' : 'transparent',
    color: selected ? 'var(--accent-blue)' : 'var(--text-secondary)',
  };
}

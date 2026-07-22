import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BackendStatus } from '@claude-alive/core';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

interface BackendsViewProps {
  active: boolean;
}

/**
 * Onboarding surface (spec §6): the backends the user connects for orchestration.
 * Lists claude-local (orchestrator), litellm (sub-agent), and ssh (location),
 * each with a live "check connection" button.
 */
export function BackendsView({ active }: BackendsViewProps) {
  const { t } = useTranslation();
  const [backends, setBackends] = useState<BackendStatus[]>([]);
  const [checking, setChecking] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/backends`);
      const data = (await res.json()) as { backends: BackendStatus[] };
      setBackends(data.backends ?? []);
    } catch {
      // leave as-is
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const check = useCallback(async (id: string) => {
    setChecking(id);
    try {
      const res = await fetch(`${API_BASE}/api/backends/${id}/check`, { method: 'POST' });
      if (res.ok) {
        const { status } = (await res.json()) as { status: BackendStatus };
        setBackends((prev) => prev.map((b) => (b.id === status.id ? status : b)));
      }
    } catch {
      // ignore
    } finally {
      setChecking(null);
    }
  }, []);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary, #e6edf3)' }}>
            {t('backends.title')}
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary, #8b949e)', lineHeight: 1.5 }}>
            {t('backends.subtitle')}
          </p>
        </div>

        {loading && backends.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.5 }}>{t('backends.loading')}</div>
        ) : (
          backends.map((b) => <BackendCard key={b.id} backend={b} checking={checking === b.id} onCheck={() => check(b.id)} t={t} />)
        )}
      </div>
    </div>
  );
}

function BackendCard({
  backend,
  checking,
  onCheck,
  t,
}: {
  backend: BackendStatus;
  checking: boolean;
  onCheck: () => void;
  t: (key: string) => string;
}) {
  const dotColor =
    backend.connected === true
      ? 'var(--accent-green, #3fb950)'
      : backend.connected === false
        ? 'var(--accent-red, #f85149)'
        : 'var(--text-secondary, #8b949e)';
  const statusText =
    backend.connected === true ? t('backends.connected') : backend.connected === false ? t('backends.failed') : t('backends.unknown');

  return (
    <div
      style={{
        background: 'var(--bg-secondary, #161b22)',
        border: '1px solid var(--border-default, #30363d)',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #e6edf3)' }}>{backend.label}</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--text-secondary, #8b949e)',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 5,
              padding: '1px 6px',
            }}
          >
            {t(`backends.kind.${backend.kind}`)}
          </span>
          <span style={{ fontSize: 11, color: dotColor, fontWeight: 600 }}>{statusText}</span>
        </div>
        {backend.detail && (
          <div
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-secondary, #8b949e)',
              opacity: 0.75,
              marginTop: 3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={backend.detail}
          >
            {backend.detail}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onCheck}
        disabled={checking}
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: '7px 14px',
          borderRadius: 8,
          border: '1px solid var(--accent-blue, #58a6ff)',
          background: 'rgba(88,166,255,0.10)',
          color: 'var(--accent-blue, #58a6ff)',
          cursor: checking ? 'wait' : 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {checking ? t('backends.checking') : t('backends.check')}
      </button>
    </div>
  );
}

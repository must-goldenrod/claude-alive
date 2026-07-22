import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketLocation } from '@claude-alive/core';
import type { TicketCreateFn } from './useTickets.ts';
import { FolderPicker } from './FolderPicker.tsx';
import { RemoteFolderPicker } from './RemoteFolderPicker.tsx';
import { loadPresets, SSH_PRESETS_CHANGED } from '../chat/sshPresets.ts';

interface NewTicketFormProps {
  onCreate: TicketCreateFn;
}

function pathBasename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
}

export function NewTicketForm({ onCreate }: NewTicketFormProps) {
  const { t } = useTranslation();
  const [goal, setGoal] = useState('');
  const [cwd, setCwd] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only presets with structured host info can be a ticket location (headless SSH
  // needs the host server-side; command-only presets stay terminal-only).
  const [sshHosts, setSshHosts] = useState(() => loadPresets().filter((p) => p.host));
  // Refresh the location picker when SSH hosts are added/removed elsewhere (e.g. the
  // Backends onboarding screen) — the form stays mounted, so re-read on the event.
  useEffect(() => {
    const onChange = () => setSshHosts(loadPresets().filter((p) => p.host));
    window.addEventListener(SSH_PRESETS_CHANGED, onChange);
    return () => window.removeEventListener(SSH_PRESETS_CHANGED, onChange);
  }, []);
  const [locId, setLocId] = useState('local');
  const [orchestrated, setOrchestrated] = useState(false);
  const preset = sshHosts.find((p) => p.id === locId);
  const isRemote = Boolean(preset);

  const location: TicketLocation | undefined = preset
    ? {
        kind: 'ssh',
        ssh: { host: preset.host!, user: preset.user, port: preset.port, identityFile: preset.identityFile },
        label: preset.label,
      }
    : undefined;

  const canSubmit = goal.trim().length > 0 && cwd.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    // Orchestrator mode delegates to sub-agents; only meaningful for local runs.
    const err = await onCreate(goal.trim(), cwd, location, orchestrated && !isRemote);
    setSubmitting(false);
    if (err) {
      setError(err); // surface the server's specific reason (e.g. bad cwd)
      return;
    }
    setError(null);
    setGoal(''); // keep cwd for the next ticket in the same project
  };

  return (
    <div
      style={{
        background: 'var(--bg-secondary, #161b22)',
        border: '1px solid var(--border-default, #30363d)',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder={t('tickets.newGoalPlaceholder')}
        rows={2}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
        }}
        style={{
          resize: 'vertical',
          fontSize: 14,
          fontFamily: 'var(--font-ui, system-ui)',
          padding: 10,
          borderRadius: 8,
          border: '1px solid var(--border-default, #30363d)',
          background: 'var(--bg-primary, #0d1117)',
          color: 'var(--text-primary, #e6edf3)',
        }}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        {/* Execution location: Local, or a registered SSH host (headless claude
            over SSH). Shown only when host-bearing presets exist. */}
        {sshHosts.length > 0 && (
          <select
            value={locId}
            onChange={(e) => {
              setLocId(e.target.value);
              setCwd(''); // local path vs remote path are not interchangeable
              setError(null);
            }}
            title={t('tickets.location')}
            style={{
              fontSize: 12,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-default, #30363d)',
              background: 'var(--bg-primary, #0d1117)',
              color: 'var(--text-primary, #e6edf3)',
              cursor: 'pointer',
              flexShrink: 0,
              maxWidth: 170,
            }}
          >
            <option value="local">{t('tickets.locationLocal')}</option>
            {sshHosts.map((p) => (
              <option key={p.id} value={p.id}>
                ⬈ {p.label}
              </option>
            ))}
          </select>
        )}
        {isRemote ? (
          // Remote path: manual entry + a folder picker that browses the host over SSH.
          <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={cwd}
              onChange={(e) => {
                setCwd(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
              }}
              placeholder={t('tickets.remotePathPlaceholder')}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                fontFamily: 'var(--font-mono, monospace)',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-default, #30363d)',
                background: 'var(--bg-primary, #0d1117)',
                color: 'var(--text-primary, #e6edf3)',
              }}
            />
            <button
              type="button"
              onClick={() => setRemotePickerOpen(true)}
              title={t('tickets.remotePickerTitle')}
              style={{
                fontSize: 13,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-default, #30363d)',
                background: 'var(--bg-primary, #0d1117)',
                color: 'var(--text-secondary, #8b949e)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              📁
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            title={cwd || t('tickets.selectFolder')}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
              fontSize: 12,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-default, #30363d)',
              background: 'var(--bg-primary, #0d1117)',
              color: cwd ? 'var(--text-primary, #e6edf3)' : 'var(--text-secondary, #8b949e)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ opacity: 0.6, flexShrink: 0 }}>📁</span>
            {cwd ? (
              <>
                <span style={{ fontWeight: 600, flexShrink: 0 }}>{pathBasename(cwd)}</span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: 10,
                    color: 'var(--text-secondary, #8b949e)',
                    opacity: 0.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  {cwd}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent-blue, #58a6ff)', flexShrink: 0 }}>
                  {t('tickets.changeFolder')}
                </span>
              </>
            ) : (
              <span>{t('tickets.selectFolder')}</span>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: canSubmit ? 'var(--accent-blue, #58a6ff)' : 'var(--bg-tertiary, #21262d)',
            color: canSubmit ? '#0d1117' : 'var(--text-secondary, #8b949e)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            whiteSpace: 'nowrap',
          }}
        >
          {submitting ? t('tickets.creating') : t('tickets.create')}
        </button>
      </div>
      {!isRemote && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary, #8b949e)', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={orchestrated} onChange={(e) => setOrchestrated(e.target.checked)} style={{ cursor: 'pointer' }} />
          <span>{t('tickets.orchestrate')}</span>
          <span style={{ opacity: 0.6 }}>{t('tickets.orchestrateHint')}</span>
        </label>
      )}
      {error && (
        <div style={{ fontSize: 12, color: 'var(--accent-red, #f85149)', lineHeight: 1.5 }}>{error}</div>
      )}
      {pickerOpen && (
        <FolderPicker
          onSelect={(path) => {
            setCwd(path);
            setError(null);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {remotePickerOpen && preset && (
        <RemoteFolderPicker
          ssh={{ host: preset.host!, user: preset.user, port: preset.port, identityFile: preset.identityFile }}
          onSelect={(path) => {
            setCwd(path);
            setError(null);
          }}
          onClose={() => setRemotePickerOpen(false)}
        />
      )}
    </div>
  );
}

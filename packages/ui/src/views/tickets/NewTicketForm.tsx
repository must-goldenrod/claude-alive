import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SshTarget, TicketLocation, TicketRunPreset } from '@claude-alive/core';
import type { TicketCreateFn } from './useTickets.ts';
import { FolderPicker } from './FolderPicker.tsx';
import { RemoteFolderPicker } from './RemoteFolderPicker.tsx';
import { loadPresets, SSH_PRESETS_CHANGED } from '../chat/sshPresets.ts';
import { DEFAULT_RUN_PRESET, RUN_PRESET_IDS, RUN_PRESET_PREVIEW, runPresetLabelKey } from './runPresets.ts';
import { BranchPicker } from './BranchPicker.tsx';

interface NewTicketFormProps {
  /**
   * Working directory chosen elsewhere (the sidebar's per-worktree "+"). It
   * seeds the folder picker so starting a run from a branch skips the picker.
   */
  presetCwd?: string;
  /**
   * The machine that path is on, when the sidebar knows it.
   *
   * A remote root is just a string, and handing one to a local agent is how a
   * ticket ended up pointed at a path that does not exist here. The path and
   * the host travel together or not at all.
   */
  presetLocation?: TicketLocation;
  onCreate: TicketCreateFn;
}

/** Location id used when the sidebar's host is not among the saved presets. */
const SIDEBAR_LOCATION = '__sidebar__';

function pathBasename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
}

/** `dev@host` / `host:port` — inlined (avoid a core runtime import in the browser bundle). */
function sshDisplay(t: SshTarget): string {
  const at = t.user ? `${t.user}@${t.host}` : t.host;
  return t.port && t.port !== 22 ? `${at}:${t.port}` : at;
}

/** Same host, same user, same port — a preset that can execute this location. */
function matchesTarget(preset: { host?: string; user?: string; port?: number }, t: SshTarget): boolean {
  return preset.host === t.host
    && (preset.user ?? undefined) === (t.user ?? undefined)
    && (preset.port ?? 22) === (t.port ?? 22);
}

export function NewTicketForm({ onCreate, presetCwd, presetLocation }: NewTicketFormProps) {
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

  // A newly supplied preset wins over whatever the picker held; the user just
  // asked for that worktree explicitly. The host moves with it: a remote root
  // selected while the composer said "Local" was submitted as a local run and
  // failed on a path this machine does not have.
  const presetTarget = presetLocation?.kind === 'ssh' ? presetLocation.ssh : undefined;
  const presetKey = presetTarget ? sshDisplay(presetTarget) : 'local';
  useEffect(() => {
    if (!presetCwd) return;
    setCwd(presetCwd);
    setError(null);
    if (!presetTarget) {
      setLocId('local');
      return;
    }
    const known = loadPresets().find((p) => p.host && matchesTarget(p, presetTarget));
    setLocId(known ? known.id : SIDEBAR_LOCATION);
    // presetKey stands in for presetTarget: re-running on every new object
    // identity would fight the user's own choice of location.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetCwd, presetKey]);
  // Default ON: orchestrated runs are the normal way tickets are executed here,
  // so the checkbox starts checked and stays a one-click opt-out.
  const [orchestrated, setOrchestrated] = useState(true);
  // Default ON: a verified ticket that is not committed gets absorbed into the
  // next ticket's diff, which is what makes per-ticket review impossible.
  const [autoCommit, setAutoCommit] = useState(true);
  // Default ON. Turning it off keeps the ticket's goal and report off the
  // third-party gateway; the local Claude gate still runs.
  const [panelReview, setPanelReview] = useState(true);
  // Which model/effort the agent runs with. `standard` reproduces the behaviour
  // tickets had before presets existed, so the default changes nothing.
  const [runPreset, setRunPreset] = useState<TicketRunPreset>(DEFAULT_RUN_PRESET);
  // The sidebar's option exists only while the sidebar is offering one; falling
  // back to Local keeps the select from rendering a blank value after the
  // selection is cleared.
  const effectiveLocId = locId === SIDEBAR_LOCATION && presetLocation === undefined ? 'local' : locId;
  const preset = sshHosts.find((p) => p.id === effectiveLocId);
  // The sidebar can name a host that was never saved as a preset (it comes from
  // the run registry, not from localStorage). That location is still executable
  // — the server only needs the target — so it is offered as its own option
  // rather than silently downgraded to Local.
  const usingSidebar = effectiveLocId === SIDEBAR_LOCATION;

  const location: TicketLocation | undefined = preset
    ? {
        kind: 'ssh',
        ssh: { host: preset.host!, user: preset.user, port: preset.port, identityFile: preset.identityFile },
        label: preset.label,
      }
    : usingSidebar
      ? presetLocation
      : undefined;
  const isRemote = location !== undefined;

  const canSubmit = goal.trim().length > 0 && cwd.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    // Orchestrator mode delegates to sub-agents; only meaningful for local runs.
    const err = await onCreate(goal.trim(), cwd, location, orchestrated && !isRemote, runPreset, autoCommit, panelReview);
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
        {(sshHosts.length > 0 || usingSidebar) && (
          <select
            value={effectiveLocId}
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
            {usingSidebar && presetTarget && (
              <option value={SIDEBAR_LOCATION}>
                ⬈ {presetLocation?.label || sshDisplay(presetTarget)}
              </option>
            )}
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
      {/* The host is not a detail to bury in a dropdown: this is the line that
          says a run will leave this machine. */}
      {isRemote && location?.ssh && (
        <div
          data-testid="ticket-remote-note"
          style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: 'var(--accent-purple, #bc8cff)' }}
        >
          ⬈ {t('tickets.runsOn', { target: sshDisplay(location.ssh) })}
        </div>
      )}
      {/* Which branch the run happens on. Local only: a remote checkout is not
          ours to move, and the hooks that would report the change are local. */}
      {!isRemote && cwd.length > 0 && <BranchPicker cwd={cwd} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)' }}>{t('tickets.presetLabel')}</span>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-tertiary, #21262d)', padding: 3, borderRadius: 10 }}>
          {RUN_PRESET_IDS.map((id) => {
            const active = runPreset === id;
            const preview = RUN_PRESET_PREVIEW[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setRunPreset(id)}
                // The model line names the version on every option rather than
                // only the selected one, so the cost ramp is legible without
                // clicking through. The exact `--model` id stays one hover away.
                title={`--model ${preview.model} --effort ${preview.effort}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 1,
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  padding: '4px 12px 5px',
                  borderRadius: 8,
                  border: 'none',
                  background: active ? 'var(--bg-secondary, #161b22)' : 'transparent',
                  color: active ? 'var(--accent-blue, #58a6ff)' : 'var(--text-secondary, #8b949e)',
                  cursor: 'pointer',
                }}
              >
                <span>{t(runPresetLabelKey(id))}</span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: 10,
                    fontWeight: 400,
                    letterSpacing: -0.2,
                    opacity: active ? 0.85 : 0.6,
                  }}
                >
                  {preview.modelLabel} · {preview.effort}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {!isRemote && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary, #8b949e)', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={orchestrated} onChange={(e) => setOrchestrated(e.target.checked)} style={{ cursor: 'pointer' }} />
          <span>{t('tickets.orchestrate')}</span>
          <span style={{ opacity: 0.6 }}>{t('tickets.orchestrateHint')}</span>
        </label>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary, #8b949e)', cursor: 'pointer', userSelect: 'none' }}>
        <input type="checkbox" checked={autoCommit} onChange={(e) => setAutoCommit(e.target.checked)} style={{ cursor: 'pointer' }} />
        <span>{t('tickets.autoCommit')}</span>
        <span style={{ opacity: 0.6 }}>{isRemote ? t('tickets.autoCommitRemoteHint') : t('tickets.autoCommitHint')}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary, #8b949e)', cursor: 'pointer', userSelect: 'none' }}>
        <input type="checkbox" checked={panelReview} onChange={(e) => setPanelReview(e.target.checked)} style={{ cursor: 'pointer' }} />
        <span>{t('tickets.panelReview')}</span>
        <span style={{ opacity: 0.6 }}>{t('tickets.panelReviewHint')}</span>
      </label>
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

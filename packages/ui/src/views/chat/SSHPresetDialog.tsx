import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { SSHPreset, SSHPresetDraft } from './sshPresets.ts';
import { buildSSHCommand } from './sshPresets.ts';

type InputMode = 'freeform' | 'structured';

interface SSHPresetDialogProps {
  open: boolean;
  presets: SSHPreset[];
  onClose: () => void;
  onSave: (draft: SSHPresetDraft, editingId: string | null) => void;
  onDelete: (id: string) => void;
  onLaunch: (preset: SSHPreset) => void;
}

const EMPTY_DRAFT: SSHPresetDraft = {
  label: '',
  command: '',
  host: '',
  user: '',
  port: 22,
  identityFile: '',
  autoRun: true,
};

export function SSHPresetDialog({
  open,
  presets,
  onClose,
  onSave,
  onDelete,
  onLaunch,
}: SSHPresetDialogProps) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('freeform');
  const [draft, setDraft] = useState<SSHPresetDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setInputMode('freeform');
      setDraft(EMPTY_DRAFT);
    }
  }, [open]);

  const builtCommand = useMemo(() => {
    if (inputMode !== 'structured') return draft.command;
    if (!draft.host || !draft.host.trim()) return '';
    return buildSSHCommand({
      host: draft.host,
      user: draft.user,
      port: draft.port,
      identityFile: draft.identityFile,
    });
  }, [inputMode, draft.command, draft.host, draft.user, draft.port, draft.identityFile]);

  const canSave = draft.label.trim().length > 0 && (builtCommand || draft.command).trim().length > 0;

  const handleEdit = (preset: SSHPreset) => {
    setEditingId(preset.id);
    setInputMode(preset.host ? 'structured' : 'freeform');
    setDraft({
      label: preset.label,
      command: preset.command,
      host: preset.host ?? '',
      user: preset.user ?? '',
      port: preset.port ?? 22,
      identityFile: preset.identityFile ?? '',
      autoRun: preset.autoRun,
    });
  };

  const handleReset = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setInputMode('freeform');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const finalCommand = inputMode === 'structured' ? builtCommand : draft.command;
    onSave({ ...draft, command: finalCommand }, editingId);
    handleReset();
  };

  if (!open) return null;

  return createPortal(
    <div
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 94vw)',
          maxHeight: '94%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary, #161b22)',
          border: '1px solid var(--border-color)',
          borderRadius: 12,
          overflow: 'hidden',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-ui, system-ui)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span>{t('terminal.ssh.dialogTitle')}</span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Existing presets */}
        {presets.length > 0 && (
          <div
            style={{
              maxHeight: 240,
              overflowY: 'auto',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            {presets.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  borderBottom: '1px solid var(--border-color)',
                  background: editingId === p.id ? 'rgba(88,166,255,0.08)' : 'transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{p.label}</div>
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.command}
                  </div>
                </div>
                <button
                  onClick={() => onLaunch(p)}
                  title={t('terminal.ssh.connect')}
                  style={inlinePresetBtn('var(--accent-blue)')}
                >
                  ▶
                </button>
                <button
                  onClick={() => handleEdit(p)}
                  title={t('terminal.ssh.edit')}
                  style={inlinePresetBtn('var(--text-secondary)')}
                >
                  ✎
                </button>
                <button
                  onClick={() => {
                    if (confirm(t('terminal.ssh.confirmDelete', { label: p.label }))) {
                      onDelete(p.id);
                      if (editingId === p.id) handleReset();
                    }
                  }}
                  title={t('terminal.ssh.delete')}
                  style={inlinePresetBtn('var(--accent-red, #f85149)')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              {editingId ? t('terminal.ssh.editTitle') : t('terminal.ssh.newTitle')}
            </span>
            <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: 2 }}>
              <ModeTab
                active={inputMode === 'freeform'}
                onClick={() => setInputMode('freeform')}
                label={t('terminal.ssh.modeFreeform')}
              />
              <ModeTab
                active={inputMode === 'structured'}
                onClick={() => setInputMode('structured')}
                label={t('terminal.ssh.modeStructured')}
              />
            </div>
          </div>

          <Field label={t('terminal.ssh.labelField')}>
            <input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder={t('terminal.ssh.labelPlaceholder')}
              style={textInputStyle}
            />
          </Field>

          {inputMode === 'freeform' ? (
            <Field label={t('terminal.ssh.commandField')}>
              <input
                value={draft.command}
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                placeholder="ssh studio"
                style={{ ...textInputStyle, fontFamily: 'var(--font-mono)' }}
              />
              <div style={hintStyle}>{t('terminal.ssh.commandHint')}</div>
            </Field>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                <Field label={t('terminal.ssh.host')}>
                  <input
                    value={draft.host ?? ''}
                    onChange={(e) => setDraft({ ...draft, host: e.target.value })}
                    placeholder="example.com"
                    style={{ ...textInputStyle, fontFamily: 'var(--font-mono)' }}
                  />
                </Field>
                <Field label={t('terminal.ssh.port')}>
                  <input
                    type="number"
                    value={draft.port ?? 22}
                    min={1}
                    max={65535}
                    onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) || 22 })}
                    style={{ ...textInputStyle, fontFamily: 'var(--font-mono)' }}
                  />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label={t('terminal.ssh.user')}>
                  <input
                    value={draft.user ?? ''}
                    onChange={(e) => setDraft({ ...draft, user: e.target.value })}
                    placeholder="root"
                    style={{ ...textInputStyle, fontFamily: 'var(--font-mono)' }}
                  />
                </Field>
                <Field label={t('terminal.ssh.identityFile')}>
                  <input
                    value={draft.identityFile ?? ''}
                    onChange={(e) => setDraft({ ...draft, identityFile: e.target.value })}
                    placeholder="~/.ssh/id_ed25519"
                    style={{ ...textInputStyle, fontFamily: 'var(--font-mono)' }}
                  />
                </Field>
              </div>
              <div
                style={{
                  padding: '6px 10px',
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {builtCommand || t('terminal.ssh.structuredHint')}
              </div>
            </>
          )}

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={draft.autoRun}
              onChange={(e) => setDraft({ ...draft, autoRun: e.target.checked })}
            />
            {t('terminal.ssh.autoRun')}
          </label>

          <div
            style={{
              padding: '8px 10px',
              fontSize: 10,
              background: 'rgba(210, 153, 34, 0.1)',
              border: '1px solid rgba(210, 153, 34, 0.3)',
              borderRadius: 6,
              color: 'var(--accent-orange, #d29922)',
              lineHeight: 1.5,
            }}
          >
            {t('terminal.ssh.securityNote')}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            {editingId ? (
              <button type="button" onClick={handleReset} style={secondaryBtn}>
                {t('terminal.ssh.cancelEdit')}
              </button>
            ) : (
              <span />
            )}
            <button type="submit" disabled={!canSave} style={{ ...primaryBtn, opacity: canSave ? 1 : 0.4 }}>
              {editingId ? t('terminal.ssh.saveChanges') : t('terminal.ssh.savePreset')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function ModeTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '3px 10px',
        fontSize: 10,
        fontWeight: 600,
        background: active ? 'var(--accent-blue)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const textInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-secondary)',
  opacity: 0.7,
  marginTop: 2,
};

const primaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  fontWeight: 600,
  background: 'var(--accent-blue)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  fontWeight: 600,
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  cursor: 'pointer',
};

function inlinePresetBtn(color: string): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color,
    border: '1px solid var(--border-color)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    lineHeight: 1,
    flexShrink: 0,
  };
}

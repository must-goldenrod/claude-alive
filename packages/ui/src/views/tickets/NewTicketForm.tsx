import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketCreateFn } from './useTickets.ts';
import { FolderPicker } from './FolderPicker.tsx';

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = goal.trim().length > 0 && cwd.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const err = await onCreate(goal.trim(), cwd);
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
        {/* Folder selection reuses the terminal's picker (browse + recents) so a
            ticket always launches against a real, server-validated directory
            instead of a hand-typed path. */}
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
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketCreateFn } from './useTickets.ts';

interface NewTicketFormProps {
  onCreate: TicketCreateFn;
}

export function NewTicketForm({ onCreate }: NewTicketFormProps) {
  const { t } = useTranslation();
  const [goal, setGoal] = useState('');
  const [cwd, setCwd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = goal.trim().length > 0 && cwd.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const ok = await onCreate(goal.trim(), cwd.trim());
    setSubmitting(false);
    if (ok) setGoal(''); // keep cwd for the next ticket in the same project
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
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder={t('tickets.cwdPlaceholder')}
          style={{
            flex: 1,
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
    </div>
  );
}

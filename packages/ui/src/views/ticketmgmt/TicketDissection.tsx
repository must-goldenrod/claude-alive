import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketEvaluation } from '@claude-alive/core';
import type { EvalLabel } from './api.ts';
import { RouteGuidePreview } from './RouteGuidePreview.tsx';

interface TicketDissectionProps {
  record: TicketEvaluation;
  guideRefreshKey: number;
  onLabel: (input: { label: EvalLabel; weight: number; note: string }) => Promise<void>;
  onReflect: (reflected: boolean) => Promise<void>;
}

function fmtFull(ts: number | undefined): string {
  if (ts == null) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/** Deep-link to the session-management view, focused on this ticket's session. */
function viewProcess(sessionId: string): void {
  window.dispatchEvent(new CustomEvent('claude-alive:navigate', { detail: { mode: 'archive', sessionId } }));
}

/**
 * Right pane: dissect one ticket's outcome and score it, then decide whether it
 * feeds the project's bias. The actual run process (tool calls, events) is not
 * embedded here — it lives in session management, one click away.
 */
export function TicketDissection({ record, guideRefreshKey, onLabel, onReflect }: TicketDissectionProps) {
  const { t } = useTranslation();
  const [weight, setWeight] = useState(record.weight);
  const [note, setNote] = useState(record.note ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reseed the editable fields whenever a different ticket is selected.
  useEffect(() => {
    setWeight(record.weight);
    setNote(record.note ?? '');
    setSaved(false);
  }, [record.ticketId, record.weight, record.note]);

  const flashSaved = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  const applyLabel = async (label: EvalLabel) => {
    setBusy(true);
    try {
      await onLabel({ label, weight, note });
      flashSaved();
    } finally {
      setBusy(false);
    }
  };

  const toggleReflect = async () => {
    setBusy(true);
    try {
      await onReflect(!record.reflected);
    } finally {
      setBusy(false);
    }
  };

  const verdict = record.verdictPassed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 860 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>#{record.seq}</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{record.headline || record.goal}</span>
        <ReflectBadge reflected={record.reflected} />
      </div>

      {/* Meta stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Stat label={t('ticketMgmt.detail.model')} value={record.model || '—'} mono />
        <Stat label={t('ticketMgmt.detail.completedAt')} value={fmtFull(record.completedAt)} />
        <Stat
          label={t('ticketMgmt.detail.verdict')}
          value={verdict == null ? '—' : verdict ? t('ticketMgmt.detail.verdictPassed') : t('ticketMgmt.detail.verdictFailed')}
        />
      </div>

      {/* Request */}
      <Field label={t('ticketMgmt.detail.goal')}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{record.goal}</div>
      </Field>

      {/* Result snapshot */}
      <Field label={t('ticketMgmt.detail.result')}>
        {record.result ? (
          <pre style={{ margin: 0, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', maxHeight: 320, overflow: 'auto' }}>
            {record.result}
          </pre>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('ticketMgmt.detail.noResult')}</div>
        )}
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => record.claudeSessionId && viewProcess(record.claudeSessionId)}
            disabled={!record.claudeSessionId}
            style={{
              fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: record.claudeSessionId ? 'pointer' : 'not-allowed',
              background: 'var(--bg-card)', color: record.claudeSessionId ? 'var(--accent-blue)' : 'var(--text-secondary)',
              border: '1px solid var(--border-color)', opacity: record.claudeSessionId ? 1 : 0.6,
            }}
          >
            {record.claudeSessionId ? t('ticketMgmt.viewSession') : t('ticketMgmt.noSession')}
          </button>
        </div>
      </Field>

      {/* Score */}
      <Field label={t('ticketMgmt.score.title')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ScoreButton active={record.label === 'good'} color="var(--accent-teal)" onClick={() => applyLabel('good')} disabled={busy}>
              {t('ticketMgmt.score.good')}
            </ScoreButton>
            <ScoreButton active={record.label === 'bad'} color="var(--accent-red)" onClick={() => applyLabel('bad')} disabled={busy}>
              {t('ticketMgmt.score.bad')}
            </ScoreButton>
            {!record.humanLabeled && (
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 5px' }}>
                {t('ticketMgmt.score.auto')}
              </span>
            )}
            {saved && <span style={{ fontSize: 11, color: 'var(--accent-teal)' }}>{t('ticketMgmt.score.saved')}</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 56 }}>{t('ticketMgmt.score.weight')}</span>
            {[1, 2, 3, 4, 5].map((w) => (
              <button
                key={w}
                onClick={() => setWeight(w)}
                style={{
                  width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: weight === w ? 'var(--accent-blue)' : 'var(--bg-card)',
                  color: weight === w ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                }}
              >
                {w}
              </button>
            ))}
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('ticketMgmt.score.notePlaceholder')}
            rows={2}
            style={{
              width: '100%', resize: 'vertical', fontSize: 12, padding: '8px 10px', borderRadius: 8,
              background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', outline: 'none',
            }}
          />
          <div>
            {/* Persist a weight/note tweak without changing the label. Falls back to
                'good' only when the record is still unrated. */}
            <button
              onClick={() => applyLabel(record.label === 'unrated' ? 'good' : record.label)}
              disabled={busy}
              style={{
                fontSize: 12, padding: '6px 14px', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', opacity: busy ? 0.6 : 1,
              }}
            >
              {t('ticketMgmt.score.save')}
            </button>
          </div>
        </div>
      </Field>

      {/* Bias reflection gate */}
      <Field label={t('ticketMgmt.reflect.title')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={toggleReflect}
            disabled={busy}
            style={{
              alignSelf: 'flex-start', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 10,
              cursor: busy ? 'default' : 'pointer',
              background: record.reflected ? 'var(--accent-teal)' : 'var(--bg-card)',
              color: record.reflected ? '#04231d' : 'var(--text-primary)',
              border: `1px solid ${record.reflected ? 'var(--accent-teal)' : 'var(--border-color)'}`,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {record.reflected ? `✓ ${t('ticketMgmt.reflect.on')}` : t('ticketMgmt.reflect.off')}
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{t('ticketMgmt.reflect.hint')}</div>
        </div>
      </Field>

      {/* Current bias for this route */}
      <RouteGuidePreview route={record.route} refreshKey={guideRefreshKey} />
    </div>
  );
}

function ReflectBadge({ reflected }: { reflected: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
        color: reflected ? 'var(--accent-teal)' : 'var(--text-secondary)',
        border: `1px solid ${reflected ? 'var(--accent-teal)' : 'var(--border-color)'}`,
      }}
    >
      {reflected ? t('ticketMgmt.reflected') : t('ticketMgmt.pending')}
    </span>
  );
}

function ScoreButton({ active, color, onClick, disabled, children }: { active: boolean; color: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
        background: active ? color : 'var(--bg-card)',
        color: active ? '#04231d' : 'var(--text-secondary)',
        border: `1px solid ${active ? color : 'var(--border-color)'}`,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: '10px 12px', background: 'var(--bg-secondary)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ border: '1px solid var(--border-color)', borderRadius: 12, padding: 14, background: 'var(--bg-secondary)' }}>{children}</div>
    </div>
  );
}

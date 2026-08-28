import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Run } from '@claude-alive/core';
import { Badge, Button, Panel, StatusDot, space, text, type BadgeTone } from './ui/index.ts';

const STATE_TONE: Record<Run['state'], BadgeTone> = {
  running: 'blue', waiting: 'amber', closed: 'neutral', abandoned: 'neutral',
};

interface RunCardProps {
  run: Run;
  onOpen: (run: Run) => void;
  onClose: (runId: string, outcome: string) => void;
  onAbandon: (runId: string) => void;
}

/**
 * One run, whatever its kind. Tickets, terminals and agent sessions all reach
 * here as the same shape, so closing work looks the same everywhere.
 */
export function RunCard({ run, onOpen, onClose, onAbandon }: RunCardProps) {
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState('');
  const isOpen = run.state === 'running' || run.state === 'waiting';

  function beginClose() {
    // Prefill with the agent's own one-liner: most closes are "yes, that".
    setOutcome(run.meta?.headline ?? '');
    setClosing(true);
  }

  function submit() {
    const trimmed = outcome.trim();
    if (trimmed.length === 0) return;
    onClose(run.runId, trimmed);
    setClosing(false);
  }

  const metaLine = [run.meta?.model, formatDuration(run.meta?.durationMs), formatCost(run.meta?.costUsd)]
    .filter((x): x is string => Boolean(x))
    .join(' · ');

  return (
    <Panel padding="sm">
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
        <StatusDot tone={STATE_TONE[run.state]} pulse={run.state === 'running'} />
        {run.meta?.seq !== undefined && <Badge tone="neutral">#{run.meta.seq}</Badge>}
        <span
          style={{
            fontSize: text.base, fontWeight: 600, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {run.title}
        </span>
      </div>

      {metaLine.length > 0 && (
        <div
          style={{
            marginTop: space[1], fontFamily: 'var(--font-mono)',
            fontSize: text.xs, color: 'var(--text-secondary)',
          }}
        >
          {metaLine}
        </div>
      )}

      {(run.outcome ?? run.meta?.headline) && (
        <div style={{ marginTop: space[2], fontSize: text.sm, color: 'var(--text-secondary)' }}>
          {run.outcome ?? run.meta?.headline}
        </div>
      )}

      {closing ? (
        <div style={{ marginTop: space[2], display: 'flex', gap: space[2], alignItems: 'center' }}>
          <input
            data-testid="run-outcome"
            autoFocus
            value={outcome}
            placeholder={t('run.outcomePlaceholder')}
            onChange={(e) => setOutcome(e.target.value)}
            onKeyDown={(e) => {
              // A Korean IME commits its last syllable with an Enter that also
              // reaches keydown; submitting there duplicates the character.
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') setClosing(false);
            }}
            style={{
              flex: 1, minWidth: 0, padding: `${space[1]} ${space[2]}`,
              borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              fontFamily: 'var(--font-ui)', fontSize: text.sm,
            }}
          />
          <Button variant="ghost" onClick={() => { onAbandon(run.runId); setClosing(false); }}>
            <span data-testid="run-abandon">{t('run.abandon')}</span>
          </Button>
        </div>
      ) : (
        <div style={{ marginTop: space[2], display: 'flex', gap: space[2], justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => onOpen(run)}>
            <span data-testid="run-open">{t('run.open')}</span>
          </Button>
          {isOpen && (
            <Button variant="primary" onClick={beginClose}>
              <span data-testid="run-close">{t('run.close')}</span>
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

function formatDuration(ms?: number): string | undefined {
  if (ms === undefined) return undefined;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatCost(usd?: number): string | undefined {
  return usd === undefined ? undefined : `$${usd.toFixed(2)}`;
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Run } from '@claude-alive/core';
import { Badge, Button, HierarchyIcon, Panel, space, text, type BadgeTone } from './ui/index.ts';

/** How many changed files the card lists before summarising the rest. */
const TOUCHED_PREVIEW = 5;

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
 * One run, whatever its kind, in a 280px column.
 *
 * The card answers three questions in order: what state is this in, what was it
 * for, and what came of it. Everything else (model, cost, elapsed) is one muted
 * line at the bottom — useful when you look for it, never competing for
 * attention with the answer.
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

  const result = run.outcome ?? run.meta?.headline;
  const metaLine = [
    shortModel(run.meta?.model),
    formatDuration(run.meta?.durationMs),
    formatCost(run.meta?.costUsd),
  ]
    .filter((x): x is string => Boolean(x))
    .join(' · ');

  return (
    <Panel padding="sm">
      {/* State first, in words. A coloured dot alone does not say whether a run
          is waiting on the agent or waiting on you. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
        <HierarchyIcon level={run.kind} color="var(--text-secondary)" />
        <Badge tone={STATE_TONE[run.state]}>{t(`run.state.${run.state}`)}</Badge>
        {run.meta?.seq !== undefined && (
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: text.xs,
              color: 'var(--text-secondary)',
              flexShrink: 0,
            }}
          >
            #{run.meta.seq}
          </span>
        )}
      </div>

      {/* The goal wraps to two lines instead of truncating at one — in a narrow
          column a single ellipsed line rarely carries enough to identify a run. */}
      <div
        style={{
          marginTop: space[2],
          fontSize: text.base,
          fontWeight: 600,
          lineHeight: 1.35,
          color: 'var(--text-primary)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}
      >
        {run.title}
      </div>

      {result && (
        <div
          style={{
            marginTop: space[2],
            fontSize: text.sm,
            lineHeight: 1.4,
            color: 'var(--text-secondary)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            wordBreak: 'break-word',
          }}
        >
          {result}
        </div>
      )}

      {/* What the run actually did to the repo. A one-line conclusion says
          whether it worked; this says what it touched — the question a summary
          can never answer. */}
      {run.touchedFiles && run.touchedFiles.length > 0 && (
        <div style={{ marginTop: space[3] }}>
          <div
            data-testid="touched-count"
            style={{
              fontFamily: 'var(--font-mono)', fontSize: text.xs, fontWeight: 700,
              letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: space[1],
            }}
          >
            {t('run.touched', { count: run.touchedFiles.length })}
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {run.touchedFiles.slice(0, TOUCHED_PREVIEW).map((path) => (
              <li
                key={path}
                title={path}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: text.xs,
                  color: 'var(--text-primary)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left',
                }}
              >
                {basename(path)}
              </li>
            ))}
          </ul>
          {run.touchedFiles.length > TOUCHED_PREVIEW && (
            <div
              data-testid="touched-more"
              style={{ fontFamily: 'var(--font-mono)', fontSize: text.xs, color: 'var(--text-secondary)', opacity: 0.7, marginTop: 2 }}
            >
              {t('run.touchedMore', { count: run.touchedFiles.length - TOUCHED_PREVIEW })}
            </div>
          )}
        </div>
      )}

      {metaLine.length > 0 && (
        <div
          style={{
            marginTop: space[2],
            fontFamily: 'var(--font-mono)',
            fontSize: text.xs,
            color: 'var(--text-secondary)',
            opacity: 0.7,
          }}
        >
          {metaLine}
        </div>
      )}

      {closing ? (
        <div style={{ marginTop: space[3], display: 'flex', flexDirection: 'column', gap: space[2] }}>
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
              width: '100%', boxSizing: 'border-box', padding: `${space[2]} ${space[2]}`,
              borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              fontFamily: 'var(--font-ui)', fontSize: text.sm,
            }}
          />
          <div style={{ display: 'flex', gap: space[2], justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => { onAbandon(run.runId); setClosing(false); }}>
              <span data-testid="run-abandon">{t('run.abandon')}</span>
            </Button>
            <Button variant="primary" onClick={submit} disabled={outcome.trim().length === 0}>
              <span data-testid="run-outcome-submit">{t('run.close')}</span>
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: space[3], display: 'flex', gap: space[2], justifyContent: 'flex-end' }}>
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

/** Just the file name — the full path is the row's title attribute. */
function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/** `claude-opus-4-8` → `opus`. The family is what anyone actually reads here. */
function shortModel(model?: string): string | undefined {
  if (!model) return undefined;
  const match = /(opus|sonnet|haiku|fable)/i.exec(model);
  return match ? match[1]!.toLowerCase() : model;
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

import { useTranslation } from 'react-i18next';
import { ConfidenceBadge, TierBadge } from '../../list/promptBadges.tsx';
import { fmtTime, type PromptListRow } from '../../list/promptTypes.ts';
import { EmptyState } from './EmptyState.tsx';
import { useSessionResource } from './useSessionResource.ts';

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isOptionalNullableNumber(value: unknown): value is number | null | undefined {
  return value === undefined || isNullableNumber(value);
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function isPromptListRow(value: unknown): value is PromptListRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.session_id === 'string' &&
    typeof row.prompt === 'string' &&
    typeof row.char_len === 'number' &&
    typeof row.word_count === 'number' &&
    typeof row.created_at === 'string' &&
    typeof row.turn_index === 'number' &&
    isNullableNumber(row.final_score) &&
    isNullableNumber(row.rule_score) &&
    isNullableNumber(row.usage_score) &&
    (row.tier === null || typeof row.tier === 'string') &&
    isOptionalNullableNumber(row.efficiency_score) &&
    isOptionalNullableString(row.confidence) &&
    isOptionalNullableNumber(row.baseline_delta)
  );
}

async function loadPrompts(
  sessionId: string,
  signal: AbortSignal,
): Promise<PromptListRow[] | null> {
  const response = await fetch('/api/prompts?limit=1000', { signal });
  if (!response.ok) {
    return null;
  }

  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const prompts = (data as Record<string, unknown>).prompts;
  if (!Array.isArray(prompts) || !prompts.every(isPromptListRow)) {
    return null;
  }

  const matches = prompts.filter((row) => row.session_id === sessionId);
  return matches.length > 0 ? matches : null;
}

interface QualityPanelProps {
  sessionId: string | null;
}

export function QualityPanel({ sessionId }: QualityPanelProps) {
  const { t } = useTranslation();
  const resource = useSessionResource(sessionId, loadPrompts);

  if (!sessionId) {
    return <EmptyState message={t('board.empty.noSession')} />;
  }
  if (resource.status !== 'ready' || !resource.value) {
    return <EmptyState message={t('board.empty.noData')} />;
  }

  return (
    <div
      style={{
        padding: 24,
        height: '100%',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {resource.value.map((row) => (
        <article
          key={row.id}
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            padding: '10px 14px',
            background: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-primary)',
                minWidth: 26,
              }}
            >
              {row.final_score ?? '—'}
            </span>
            <TierBadge tier={row.tier} />
            <ConfidenceBadge
              confidence={row.confidence}
              delta={row.baseline_delta}
            />
            <time
              dateTime={row.created_at}
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                color: 'var(--text-secondary)',
                opacity: 0.6,
              }}
            >
              {fmtTime(row.created_at)}
            </time>
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {row.prompt}
          </div>
        </article>
      ))}
    </div>
  );
}

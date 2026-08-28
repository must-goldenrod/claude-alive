import { useTranslation } from 'react-i18next';
import { PromptListContent } from '../../list/PromptListContent.tsx';
import type { PromptListRow } from '../../list/promptTypes.ts';
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
  const response = await fetch(
    `/api/prompts?limit=500&session_id=${encodeURIComponent(sessionId)}`,
    { signal },
  );
  if (!response.ok) {
    return null;
  }

  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const prompts = (data as Record<string, unknown>).prompts;
  if (!Array.isArray(prompts)) {
    return null;
  }

  const rawMatches = prompts.filter(
    (row) =>
      typeof row === 'object' &&
      row !== null &&
      (row as Record<string, unknown>).session_id === sessionId,
  );
  if (rawMatches.length === 0 || !rawMatches.every(isPromptListRow)) {
    return null;
  }
  return rawMatches;
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
  if (resource.status === 'loading') {
    return <EmptyState message={t('prompt.loading')} />;
  }
  if (resource.status !== 'ready' || !resource.value) {
    return <EmptyState message={t('board.empty.noData')} />;
  }

  return <PromptListContent rows={resource.value} />;
}

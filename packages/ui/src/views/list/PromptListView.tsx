import { useCallback, useEffect, useState } from 'react';
import type { PromptListRow } from './promptTypes.ts';
import { PromptListContent } from './PromptListContent.tsx';

interface PromptListViewProps {
  /** Parent toggles display: 'none' / 'block' instead of unmounting; we only poll while visible. */
  active: boolean;
  /**
   * Deep-link from the dashboard cards. When non-null and present in
   * the current list, we adopt it as the selected id and clear it on
   * the parent via onSelectConsumed so subsequent user clicks aren't
   * overridden.
   */
  requestedSelectId?: string | null;
  onSelectConsumed?: () => void;
}

export function PromptListView({
  active,
  requestedSelectId,
  onSelectConsumed,
}: PromptListViewProps) {
  const [rows, setRows] = useState<PromptListRow[]>([]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/prompts?limit=100');
      if (!response.ok) return;
      const data = (await response.json()) as { prompts: PromptListRow[] };
      setRows(data.prompts);
    } catch {
      // Network errors are handled by the parent shell.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [active, refresh]);

  return (
    <PromptListContent
      rows={rows}
      requestedSelectId={requestedSelectId}
      onSelectConsumed={onSelectConsumed}
    />
  );
}

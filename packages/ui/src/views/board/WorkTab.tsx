import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketEvaluation } from '@claude-alive/core';
import {
  fetchRecords,
  setLabel,
  setReflected,
  type EvalLabel,
} from '../ticketmgmt/api.ts';
import { TicketDetailTabs } from './TicketDetailTabs.tsx';
import { EmptyState } from './panels/EmptyState.tsx';

interface WorkTabProps {
  active: boolean;
  /**
   * Run focused in the shared sidebar, e.g. `ticket:t-1`. The board no longer
   * carries its own ticket list — that was a duplicate of the sidebar — so the
   * detail it renders is whatever the sidebar points at.
   */
  focusedRunId: string | null;
}

const TICKET_RUN_PREFIX = 'ticket:';

export function WorkTab({ active, focusedRunId }: WorkTabProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<TicketEvaluation[] | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [guideRefreshKey, setGuideRefreshKey] = useState(0);
  const refreshGenerationRef = useRef(0);
  const refreshEnabledRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!refreshEnabledRef.current) {
      return;
    }

    const generation = ++refreshGenerationRef.current;
    try {
      const nextRecords = await fetchRecords();
      if (!refreshEnabledRef.current || generation !== refreshGenerationRef.current) {
        return;
      }
      setRecords(nextRecords);
      setReachable(true);
    } catch {
      if (!refreshEnabledRef.current || generation !== refreshGenerationRef.current) {
        return;
      }
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      refreshEnabledRef.current = false;
      refreshGenerationRef.current += 1;
      return;
    }

    refreshEnabledRef.current = true;
    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 10000);

    return () => {
      refreshEnabledRef.current = false;
      refreshGenerationRef.current += 1;
      window.clearInterval(intervalId);
    };
  }, [active, refresh]);

  // Only ticket runs have an evaluation record; a terminal or agent run focused
  // in the sidebar simply has no board detail to show.
  const selectedId = focusedRunId?.startsWith(TICKET_RUN_PREFIX)
    ? focusedRunId.slice(TICKET_RUN_PREFIX.length)
    : null;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const selected = useMemo(
    () =>
      selectedId
        ? (records ?? []).find((record) => record.ticketId === selectedId) ?? null
        : null,
    [records, selectedId],
  );

  const applyRecord = useCallback((nextRecord: TicketEvaluation) => {
    setRecords((previous) =>
      previous
        ? previous.map((record) =>
            record.ticketId === nextRecord.ticketId ? nextRecord : record,
          )
        : previous,
    );
  }, []);

  const handleLabel = useCallback(
    async (input: { label: EvalLabel; weight: number; note: string }) => {
      if (!selected) {
        return;
      }

      try {
        applyRecord(await setLabel(selected.ticketId, input));
      } catch (error) {
        void refresh();
        throw error;
      }
    },
    [applyRecord, refresh, selected],
  );

  const handleReflect = useCallback(
    async (reflected: boolean) => {
      if (!selected) {
        return;
      }

      const ticketId = selected.ticketId;
      try {
        applyRecord(await setReflected(ticketId, reflected));
        if (selectedIdRef.current === ticketId) {
          setGuideRefreshKey((current) => current + 1);
        }
      } catch {
        void refresh();
      }
    },
    [applyRecord, refresh, selected],
  );

  if (reachable === false) {
    return <EmptyState message={t('ticketMgmt.unreachable.body')} />;
  }

  if (!selectedId) {
    return <EmptyState message={t('board.pickRun')} />;
  }

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      <TicketDetailTabs
        record={selected}
        sessionId={selected?.claudeSessionId ?? null}
        guideRefreshKey={guideRefreshKey}
        onLabel={handleLabel}
        onReflect={handleReflect}
      />
    </div>
  );
}

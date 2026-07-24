import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketEvaluation } from '@claude-alive/core';
import {
  fetchRecords,
  setLabel,
  setReflected,
  type EvalLabel,
} from '../ticketmgmt/api.ts';
import { TicketDetailTabs } from './TicketDetailTabs.tsx';
import { TicketList } from './TicketList.tsx';
import { EmptyState } from './panels/EmptyState.tsx';

interface WorkTabProps {
  active: boolean;
}

export function WorkTab({ active }: WorkTabProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<TicketEvaluation[] | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guideRefreshKey, setGuideRefreshKey] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const nextRecords = await fetchRecords();
      setRecords(nextRecords);
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [active, refresh]);

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
      } catch {
        void refresh();
      }
    },
    [applyRecord, refresh, selected],
  );

  const handleReflect = useCallback(
    async (reflected: boolean) => {
      if (!selected) {
        return;
      }

      try {
        applyRecord(await setReflected(selected.ticketId, reflected));
        setGuideRefreshKey((current) => current + 1);
      } catch {
        void refresh();
      }
    },
    [applyRecord, refresh, selected],
  );

  if (reachable === false) {
    return <EmptyState message={t('ticketMgmt.unreachable.body')} />;
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: 440,
          minWidth: 300,
          maxWidth: '50%',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-secondary)',
        }}
      >
        <TicketList records={records} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <TicketDetailTabs
          record={selected}
          sessionId={selected?.claudeSessionId ?? null}
          guideRefreshKey={guideRefreshKey}
          onLabel={handleLabel}
          onReflect={handleReflect}
        />
      </div>
    </div>
  );
}

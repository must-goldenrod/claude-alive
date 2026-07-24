import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketEvaluation } from '@claude-alive/core';
import { fetchRecords, setLabel, setReflected, type EvalLabel } from './api.ts';
import { TicketDissection } from './TicketDissection.tsx';
import { TicketList } from '../board/TicketList.tsx';

interface TicketMgmtViewProps {
  active: boolean;
}

/**
 * Ticket management (spec 2026-07-22): a route-grouped, score-and-decide surface
 * over the durable ticket-evaluation dataset. Left pane groups tickets by project
 * (route); right pane dissects one ticket and gates whether it shapes the bias.
 */
export function TicketMgmtView({ active }: TicketMgmtViewProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<TicketEvaluation[] | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guideRefreshKey, setGuideRefreshKey] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const recs = await fetchRecords();
      setRecords(recs);
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [active, refresh]);

  const selected = useMemo(
    () => (selectedId ? (records ?? []).find((r) => r.ticketId === selectedId) ?? null : null),
    [records, selectedId],
  );

  const applyRecord = useCallback((rec: TicketEvaluation) => {
    setRecords((prev) => (prev ? prev.map((r) => (r.ticketId === rec.ticketId ? rec : r)) : prev));
  }, []);

  const handleLabel = useCallback(
    async (ticketId: string, input: { label: EvalLabel; weight: number; note: string }) => {
      try {
        const rec = await setLabel(ticketId, input);
        applyRecord(rec);
      } catch {
        // Server rejected — pull fresh truth so the UI never shows a phantom change.
        refresh();
      }
    },
    [applyRecord, refresh],
  );

  const handleReflect = useCallback(
    async (ticketId: string, reflected: boolean) => {
      try {
        const rec = await setReflected(ticketId, reflected);
        applyRecord(rec);
        setGuideRefreshKey((k) => k + 1); // the bias changed → refetch the preview
      } catch {
        refresh();
      }
    },
    [applyRecord, refresh],
  );

  const containerStyle: React.CSSProperties = { display: 'flex', height: '100%', width: '100%', overflow: 'hidden' };

  if (reachable === false) {
    return (
      <div style={{ ...containerStyle, alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', flexDirection: 'column', gap: 8, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{t('ticketMgmt.unreachable.title')}</div>
        <div style={{ fontSize: 13, maxWidth: 460, lineHeight: 1.5 }}>{t('ticketMgmt.unreachable.body')}</div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* List pane */}
      <div style={{ width: 440, minWidth: 300, maxWidth: '50%', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
        <TicketList records={records} selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      {/* Detail pane */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24, minWidth: 0 }}>
        {!selected ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('ticketMgmt.detail.empty')}</div>
        ) : (
          <TicketDissection
            record={selected}
            guideRefreshKey={guideRefreshKey}
            onLabel={(input) => handleLabel(selected.ticketId, input)}
            onReflect={(reflected) => handleReflect(selected.ticketId, reflected)}
          />
        )}
      </div>
    </div>
  );
}

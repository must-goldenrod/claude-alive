import type { TicketEvaluation } from '@claude-alive/core';
import type { EvalLabel } from '../../ticketmgmt/api.ts';
import { TicketDissection } from '../../ticketmgmt/TicketDissection.tsx';

interface OutcomePanelProps {
  record: TicketEvaluation;
  guideRefreshKey: number;
  onLabel: (input: { label: EvalLabel; weight: number; note: string }) => Promise<void>;
  onReflect: (reflected: boolean) => Promise<void>;
}

export function OutcomePanel({
  record,
  guideRefreshKey,
  onLabel,
  onReflect,
}: OutcomePanelProps) {
  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <TicketDissection
        record={record}
        guideRefreshKey={guideRefreshKey}
        onLabel={onLabel}
        onReflect={onReflect}
      />
    </div>
  );
}

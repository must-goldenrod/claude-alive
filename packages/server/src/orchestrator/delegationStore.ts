/**
 * Reads the `ca-delegate` delegation log and returns the records for a ticket.
 *
 * ca-delegate appends one JSON line per delegation (tagged with CA_TICKET_ID);
 * the runner attaches the matching records to the ticket on settle so the UI can
 * show which sub-agent models did what.
 */
import { readFileSync } from 'node:fs';
import type { TicketDelegation } from '@claude-alive/core';
import { DELEGATION_LOG } from './delegateCli.js';

export function readDelegations(ticketId: string, logPath: string = DELEGATION_LOG): TicketDelegation[] {
  let raw: string;
  try {
    raw = readFileSync(logPath, 'utf-8');
  } catch {
    return []; // no log yet
  }
  const out: TicketDelegation[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t) as { ticketId?: string } & TicketDelegation;
      if (r.ticketId !== ticketId) continue;
      out.push({
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        totalTokens: r.totalTokens,
        costUsd: r.costUsd,
        promptPreview: r.promptPreview,
        at: r.at,
      });
    } catch {
      // skip a corrupt line
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

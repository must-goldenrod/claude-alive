import type { Ticket } from '@claude-alive/core';

/**
 * The one line a failed ticket shows.
 *
 * A category (`verification-failed`) tells you nothing you can act on. The
 * verifier writes an actual sentence explaining what it judged missing, and the
 * runner records the crash message — those come first; the category is the last
 * resort, not the default.
 */
export function failureLine(ticket: Ticket, t: (key: string) => string): string {
  const verifierReason = ticket.verification && !ticket.verification.passed
    ? oneLine(ticket.verification.reason)
    : undefined;
  if (verifierReason) return verifierReason;

  const crash = oneLine(ticket.error);
  if (crash) return crash;

  if (ticket.failureReason) return t(`tickets.failureReason.${ticket.failureReason}`);
  return t('tickets.status.failed');
}

/** Collapse whitespace so a multi-paragraph reason still fits one card line. */
function oneLine(text: string | undefined): string | undefined {
  const collapsed = text?.replace(/\s+/g, ' ').trim();
  return collapsed && collapsed.length > 0 ? collapsed : undefined;
}

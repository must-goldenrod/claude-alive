/**
 * The completion gate's deterministic eyes.
 *
 * Everything else that judges a finished ticket — the Claude gate, the LiteLLM
 * panel, the Jev fallback — reads text the agent wrote about its own work. That
 * is the same material a confidently wrong report is made of, and it is why a
 * report can be accurate about the wrong work and still pass.
 *
 * This is the one input that is not text about the work. It opens the page the
 * ticket named and asks questions with only one answer: does it respond, do the
 * elements exist, is the title empty. No inference, no tokens, the same result
 * on every run.
 *
 * It is not allowed to fail a ticket (see `withPage` in `ticketVerifier.ts`).
 * A dev server that is simply not running would otherwise fail good work, and a
 * signal earns a veto by being measured first, not by being new.
 */
import type { BrowserVerification, Ticket } from '@claude-alive/core';
import { inspectUrl } from './index.js';

/** Only a page this server could actually have been pointed at on purpose. */
export function isCheckableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface VerifyPageOptions {
  /** Elements that must exist. Empty = "the page responded" is the whole check. */
  selectors?: readonly string[];
  headless?: boolean;
  /** Injected in tests. */
  inspect?: typeof inspectUrl;
}

/**
 * Run the deterministic half of a page inspection for one ticket.
 *
 * `backend: 'none'` is not a default that might drift — it is the point. The
 * gate already pays for inference three times over; this step exists precisely
 * because it costs nothing and cannot hallucinate.
 */
export async function verifyPage(
  ticket: Pick<Ticket, 'verifyUrl'>,
  options: VerifyPageOptions = {},
): Promise<BrowserVerification | null> {
  const url = ticket.verifyUrl;
  if (!url || !isCheckableUrl(url)) return null;

  const inspect = options.inspect ?? inspectUrl;
  const report = await inspect(
    {
      url,
      selectors: [...(options.selectors ?? [])],
      checkLinks: false,
      screenshot: false,
    },
    { headless: options.headless ?? true, backend: 'none' },
  );

  const failed = report.checks
    .filter((check) => check.status === 'fail' || check.status === 'error')
    .map((check) => (check.detail ? `${check.name} (${check.detail})` : check.name));

  return {
    url,
    summary: report.summary,
    failed,
    ...(report.facts?.title ? { title: report.facts.title } : {}),
  };
}

/**
 * Deterministic page checks — the LLM-free half of browser inspection.
 *
 * Everything here runs through CDP only: no inference, no tokens, a few
 * milliseconds per check, and the same answer on every run. Judgement calls
 * ("does this look broken to a human") belong in the Claude-backed layer.
 */

/** The slice of Stagehand's `Page` these checks need. Keeps them testable. */
export interface PageLike {
  goto(url: string, options?: unknown): Promise<unknown>;
  evaluate<R = unknown>(expression: string): Promise<R>;
  screenshot(options?: unknown): Promise<Uint8Array>;
  snapshot(options?: unknown): Promise<{ formattedTree: string }>;
}

export type CheckStatus = 'pass' | 'fail' | 'error' | 'skip';

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail?: string;
}

export interface PageFacts {
  readonly url: string;
  readonly title: string;
  readonly links: string[];
  readonly images: Array<{ src: string; alt: string }>;
  readonly headings: Array<{ level: number; text: string }>;
  readonly formCount: number;
  readonly metaDescription: string | null;
  readonly lang: string | null;
}

/** One round trip collects everything; per-fact evaluates would be wasteful. */
const FACTS_SCRIPT = `(() => ({
  url: location.href,
  title: document.title,
  links: Array.from(document.querySelectorAll('a[href]')).map((a) => a.href),
  images: Array.from(document.querySelectorAll('img')).map((i) => ({ src: i.currentSrc || i.src, alt: i.getAttribute('alt') ?? '' })),
  headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? '').trim() })),
  formCount: document.querySelectorAll('form').length,
  metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
  lang: document.documentElement.getAttribute('lang'),
}))()`;

/** Collect the structural facts of the current page in a single evaluate. */
export async function collectPageFacts(page: PageLike): Promise<PageFacts> {
  return page.evaluate<PageFacts>(FACTS_SCRIPT);
}

/** Assert that each CSS selector matches at least one element. */
export async function checkSelectors(page: PageLike, selectors: readonly string[]): Promise<CheckResult[]> {
  if (selectors.length === 0) return [];
  const script = `(() => { const out = {}; for (const s of ${JSON.stringify(selectors)}) { try { out[s] = document.querySelectorAll(s).length; } catch { out[s] = -1; } } return out; })()`;
  const counts = await page.evaluate<Record<string, number>>(script);
  return selectors.map((selector) => {
    const count = counts[selector] ?? 0;
    if (count < 0) return { name: `selector ${selector}`, status: 'error', detail: 'invalid selector' };
    return count > 0
      ? { name: `selector ${selector}`, status: 'pass', detail: `${count} match(es)` }
      : { name: `selector ${selector}`, status: 'fail', detail: 'no match' };
  });
}

export interface LinkCheckOptions {
  readonly fetchImpl?: typeof fetch;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
}

/** Run `tasks` with at most `limit` in flight, preserving result order. */
async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Resolve each link target and report its HTTP status. */
export async function checkLinkTargets(
  links: readonly string[],
  options: LinkCheckOptions = {},
): Promise<CheckResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const unique = [...new Set(links)];

  return mapWithLimit(unique, options.concurrency ?? 5, async (url): Promise<CheckResult> => {
    if (!/^https?:/i.test(url)) return { name: `link ${url}`, status: 'skip', detail: 'not an http(s) url' };
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
      return response.status < 400
        ? { name: `link ${url}`, status: 'pass', detail: `HTTP ${response.status}` }
        : { name: `link ${url}`, status: 'fail', detail: `HTTP ${response.status}` };
    } catch (error) {
      return { name: `link ${url}`, status: 'error', detail: String(error instanceof Error ? error.message : error) };
    } finally {
      clearTimeout(timer);
    }
  });
}

export interface CheckSummary {
  readonly total: number;
  readonly pass: number;
  readonly fail: number;
  readonly error: number;
  readonly skip: number;
  /** False when anything failed or errored — the single signal a caller acts on. */
  readonly ok: boolean;
}

/** Fold results into counts plus one overall verdict. */
export function summarize(results: readonly CheckResult[]): CheckSummary {
  const count = (status: CheckStatus): number => results.filter((r) => r.status === status).length;
  const fail = count('fail');
  const error = count('error');
  return {
    total: results.length,
    pass: count('pass'),
    fail,
    error,
    skip: count('skip'),
    ok: fail === 0 && error === 0,
  };
}

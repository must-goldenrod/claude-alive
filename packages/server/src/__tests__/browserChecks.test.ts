import { describe, it, expect, vi } from 'vitest';
import {
  collectPageFacts,
  checkSelectors,
  checkLinkTargets,
  summarize,
  type PageLike,
} from '../browser/checks.js';

const fakePage = (facts: unknown, snapshot = 'RootWebArea: T'): PageLike => ({
  goto: vi.fn().mockResolvedValue(null),
  evaluate: vi.fn().mockResolvedValue(facts),
  screenshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  snapshot: vi.fn().mockResolvedValue({ formattedTree: snapshot }),
});

describe('collectPageFacts', () => {
  it('returns the facts gathered in a single evaluate call', async () => {
    const facts = {
      url: 'https://x.test/',
      title: 'T',
      links: ['https://x.test/a'],
      images: [{ src: 'https://x.test/i.png', alt: 'i' }],
      headings: [{ level: 1, text: 'H' }],
      formCount: 1,
      metaDescription: 'd',
      lang: 'ko',
    };
    const page = fakePage(facts);
    await expect(collectPageFacts(page)).resolves.toEqual(facts);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('reports images missing alt text as a derived fact', async () => {
    const page = fakePage({
      url: 'u', title: 't', links: [],
      images: [{ src: 'a.png', alt: '' }, { src: 'b.png', alt: 'ok' }],
      headings: [], formCount: 0, metaDescription: null, lang: null,
    });
    const facts = await collectPageFacts(page);
    expect(facts.images.filter((i) => i.alt === '')).toHaveLength(1);
  });
});

describe('checkSelectors', () => {
  it('passes when every required selector is present', async () => {
    const page = fakePage(null);
    page.evaluate = vi.fn().mockResolvedValue({ 'h1': 1, '.cta': 2 });
    const results = await checkSelectors(page, ['h1', '.cta']);
    expect(results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('fails the selectors that matched nothing', async () => {
    const page = fakePage(null);
    page.evaluate = vi.fn().mockResolvedValue({ 'h1': 1, '.missing': 0 });
    const results = await checkSelectors(page, ['h1', '.missing']);
    expect(results.find((r) => r.name.includes('.missing'))?.status).toBe('fail');
  });

  it('returns no results for an empty selector list without calling the page', async () => {
    const page = fakePage(null);
    await expect(checkSelectors(page, [])).resolves.toEqual([]);
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});

describe('checkLinkTargets', () => {
  it('flags non-ok status codes as failures', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      ({ status: url.endsWith('/bad') ? 404 : 200 }) as Response);
    const results = await checkLinkTargets(['https://x.test/ok', 'https://x.test/bad'], { fetchImpl });
    expect(results.find((r) => r.name.includes('/bad'))?.status).toBe('fail');
    expect(results.find((r) => r.name.includes('/ok'))?.status).toBe('pass');
  });

  it('records a network failure as an error, not a crash', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const results = await checkLinkTargets(['https://x.test/a'], { fetchImpl });
    expect(results[0]!.status).toBe('error');
    expect(results[0]!.detail).toMatch(/ECONNREFUSED/);
  });

  it('skips non-http links instead of fetching them', async () => {
    const fetchImpl = vi.fn();
    const results = await checkLinkTargets(['mailto:a@b.c', 'javascript:void(0)'], { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(results.every((r) => r.status === 'skip')).toBe(true);
  });

  it('deduplicates repeated URLs', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200 }) as Response);
    await checkLinkTargets(['https://x.test/a', 'https://x.test/a'], { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('honours the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { status: 200 } as Response;
    });
    const urls = Array.from({ length: 10 }, (_, i) => `https://x.test/${i}`);
    await checkLinkTargets(urls, { fetchImpl, concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe('summarize', () => {
  it('counts each status and marks the run failed when any check fails', () => {
    const s = summarize([
      { name: 'a', status: 'pass' },
      { name: 'b', status: 'fail', detail: 'x' },
      { name: 'c', status: 'error', detail: 'y' },
      { name: 'd', status: 'skip' },
    ]);
    expect(s).toEqual({ total: 4, pass: 1, fail: 1, error: 1, skip: 1, ok: false });
  });

  it('marks the run ok when nothing failed or errored', () => {
    expect(summarize([{ name: 'a', status: 'pass' }, { name: 'b', status: 'skip' }]).ok).toBe(true);
  });

  it('treats an empty check list as ok', () => {
    expect(summarize([])).toEqual({ total: 0, pass: 0, fail: 0, error: 0, skip: 0, ok: true });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { inspectPage, assertInspectableUrl } from '../browser/inspect.js';
import type { PageLike } from '../browser/checks.js';

const facts = {
  url: 'https://x.test/', title: 'T', links: ['https://x.test/a'],
  images: [{ src: 'i.png', alt: '' }], headings: [{ level: 1, text: 'H' }],
  formCount: 0, metaDescription: null, lang: 'ko',
};

const page = (): PageLike => ({
  goto: vi.fn().mockResolvedValue(null),
  evaluate: vi.fn().mockResolvedValue(facts),
  screenshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  snapshot: vi.fn().mockResolvedValue({ formattedTree: 'RootWebArea: T' }),
});

describe('assertInspectableUrl', () => {
  it('accepts http and https', () => {
    expect(() => { assertInspectableUrl('https://x.test'); }).not.toThrow();
    expect(() => { assertInspectableUrl('http://x.test'); }).not.toThrow();
  });

  it('rejects other schemes so a check cannot read local files', () => {
    expect(() => { assertInspectableUrl('file:///etc/passwd'); }).toThrow(/http/i);
    expect(() => { assertInspectableUrl('javascript:alert(1)'); }).toThrow(/http/i);
  });

  it('rejects a malformed url', () => {
    expect(() => { assertInspectableUrl('not a url'); }).toThrow();
  });
});

describe('inspectPage', () => {
  it('navigates once and reports the collected facts', async () => {
    const p = page();
    const report = await inspectPage(p, { url: 'https://x.test/' });
    expect(p.goto).toHaveBeenCalledWith('https://x.test/', expect.anything());
    expect(report.facts).toEqual(facts);
    expect(report.summary.ok).toBe(true);
  });

  it('runs selector checks when the spec asks for them', async () => {
    const p = page();
    p.evaluate = vi.fn()
      .mockResolvedValueOnce(facts)
      .mockResolvedValueOnce({ h1: 1, '.gone': 0 });
    const report = await inspectPage(p, { url: 'https://x.test/', selectors: ['h1', '.gone'] });
    expect(report.summary.fail).toBe(1);
    expect(report.summary.ok).toBe(false);
  });

  it('captures a screenshot only when requested', async () => {
    const p = page();
    const without = await inspectPage(p, { url: 'https://x.test/' });
    expect(without.screenshotBase64).toBeUndefined();
    expect(p.screenshot).not.toHaveBeenCalled();

    const withShot = await inspectPage(p, { url: 'https://x.test/', screenshot: true });
    expect(withShot.screenshotBase64).toBe(Buffer.from([1, 2, 3]).toString('base64'));
  });

  it('checks link targets when asked, using the injected fetch', async () => {
    const p = page();
    const fetchImpl = vi.fn(async () => ({ status: 500 }) as Response);
    const report = await inspectPage(p, { url: 'https://x.test/', checkLinks: true }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(report.summary.fail).toBe(1);
  });

  it('skips questions when no LLM-backed extract is available', async () => {
    const p = page();
    const report = await inspectPage(p, { url: 'https://x.test/', questions: ['레이아웃이 깨졌나?'] });
    expect(report.answers).toEqual([]);
    expect(report.checks.find((c) => c.name.startsWith('question'))?.status).toBe('skip');
  });

  it('routes questions through extract when one is provided', async () => {
    const p = page();
    const extract = vi.fn().mockResolvedValue({ data: { answer: '아니오', ok: true } });
    const report = await inspectPage(p, { url: 'https://x.test/', questions: ['깨졌나?'] }, { extract });
    expect(extract).toHaveBeenCalledWith('깨졌나?');
    expect(report.answers).toEqual([{ question: '깨졌나?', answer: '아니오', ok: true }]);
    expect(report.checks.find((c) => c.name.startsWith('question'))?.status).toBe('pass');
  });

  it('records an extract failure as an error check rather than throwing', async () => {
    const p = page();
    const extract = vi.fn().mockRejectedValue(new Error('rate limited'));
    const report = await inspectPage(p, { url: 'https://x.test/', questions: ['q'] }, { extract });
    expect(report.checks.find((c) => c.name.startsWith('question'))?.status).toBe('error');
    expect(report.summary.ok).toBe(false);
  });

  it('marks a question answered as not-ok as a failed check', async () => {
    const p = page();
    const extract = vi.fn().mockResolvedValue({ data: { answer: '깨졌음', ok: false } });
    const report = await inspectPage(p, { url: 'https://x.test/', questions: ['q'] }, { extract });
    expect(report.checks.find((c) => c.name.startsWith('question'))?.status).toBe('fail');
  });
});

describe('RELAXED_DEFAULT_FLAGS', () => {
  it('does not drop --remote-allow-origins, which Stagehand needs to connect', async () => {
    const { RELAXED_DEFAULT_FLAGS } = await import('../browser/session.js');
    expect(RELAXED_DEFAULT_FLAGS).not.toContain('--remote-allow-origins=*');
    expect(RELAXED_DEFAULT_FLAGS).toContain('--enable-unsafe-extension-debugging');
  });
});

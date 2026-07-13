import { describe, it, expect } from 'vitest';
import { makeTabId, generateFallbackUuid } from '../views/chat/tabId.ts';

describe('makeTabId', () => {
  it('produces a tab- prefixed, non-sequential id', () => {
    const id = makeTabId();
    expect(id).toMatch(/^tab-/);
    // Regression guard: must NOT be the old sequential form (tab-1, tab-2, …),
    // which reset per page load and collided with the server's global registry.
    expect(id).not.toMatch(/^tab-\d+$/);
  });

  it('never repeats across many calls (globally unique)', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => makeTabId()));
    expect(ids.size).toBe(1000);
  });

  it('generateFallbackUuid returns a canonical 8-4-4-4-12 v4 layout', () => {
    expect(generateFallbackUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

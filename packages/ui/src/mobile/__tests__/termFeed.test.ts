import { describe, it, expect } from 'vitest';
import { createTermFeed, type TermEvent } from '../termFeed.ts';
import { fitFontSize, MIN_FONT_PX } from '../MobileXterm.tsx';

describe('createTermFeed', () => {
  it('hands events that arrived before the terminal mounted over on listen, in order', () => {
    const feed = createTermFeed();
    feed.push({ kind: 'size', cols: 120, rows: 40 });
    feed.push({ kind: 'data', data: 'a' });
    const got: TermEvent[] = [];
    feed.listen((e) => got.push(e));
    feed.push({ kind: 'data', data: 'b' });
    expect(got).toEqual([
      { kind: 'size', cols: 120, rows: 40 },
      { kind: 'data', data: 'a' },
      { kind: 'data', data: 'b' },
    ]);
  });

  it('buffers again after the consumer detaches', () => {
    const feed = createTermFeed();
    const first: TermEvent[] = [];
    const off = feed.listen((e) => first.push(e));
    off();
    feed.push({ kind: 'reset' });
    expect(first).toEqual([]);
    const second: TermEvent[] = [];
    feed.listen((e) => second.push(e));
    expect(second).toEqual([{ kind: 'reset' }]);
  });
});

describe('fitFontSize', () => {
  it('shrinks the font so the pty columns fit the width', () => {
    // 360px / (60 cols × 0.6) = 10px
    expect(fitFontSize(360, 60, 0.6, 13)).toBe(10);
  });

  it('never grows past the configured font size', () => {
    expect(fitFontSize(2000, 40, 0.6, 13)).toBe(13);
  });

  it('stops at a readable floor and leaves the rest to horizontal scroll', () => {
    expect(fitFontSize(360, 200, 0.6, 13)).toBe(MIN_FONT_PX);
  });

  it('falls back to the configured size when the width is unknown', () => {
    expect(fitFontSize(0, 80, 0.6, 13)).toBe(13);
  });
});

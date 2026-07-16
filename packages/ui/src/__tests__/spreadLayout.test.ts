import { describe, it, expect } from 'vitest';
import {
  defaultGrid,
  makeEqualFractions,
  fractionsToTemplate,
  resizeAdjacent,
  bumpTrack,
  slotToRC,
  rcToSlot,
  neighborSlot,
  MIN_FRACTION,
} from '../views/chat/spreadLayout';

describe('defaultGrid', () => {
  it('is a near-square, columns-first', () => {
    expect(defaultGrid(1)).toEqual({ cols: 1, rows: 1 });
    expect(defaultGrid(2)).toEqual({ cols: 2, rows: 1 });
    expect(defaultGrid(3)).toEqual({ cols: 2, rows: 2 });
    expect(defaultGrid(4)).toEqual({ cols: 2, rows: 2 });
    expect(defaultGrid(5)).toEqual({ cols: 3, rows: 2 });
    expect(defaultGrid(9)).toEqual({ cols: 3, rows: 3 });
  });
  it('degrades safely for 0/negative', () => {
    expect(defaultGrid(0)).toEqual({ cols: 1, rows: 1 });
    expect(defaultGrid(-4)).toEqual({ cols: 1, rows: 1 });
  });
});

describe('fractions', () => {
  it('makeEqualFractions returns count 1s (min 1)', () => {
    expect(makeEqualFractions(3)).toEqual([1, 1, 1]);
    expect(makeEqualFractions(0)).toEqual([1]);
  });
  it('fractionsToTemplate maps to fr tracks', () => {
    expect(fractionsToTemplate([1, 2, 1])).toBe('1fr 2fr 1fr');
    expect(fractionsToTemplate([])).toBe('1fr');
  });
});

describe('resizeAdjacent', () => {
  it('shifts the boundary and preserves the pair sum', () => {
    // 2 equal tracks over 200px, drag +50px → +0.5fr / -0.5fr.
    const next = resizeAdjacent([1, 1], 0, 50, 200);
    expect(next[0]! + next[1]!).toBeCloseTo(2);
    expect(next[0]!).toBeCloseTo(1.5);
    expect(next[1]!).toBeCloseTo(0.5);
  });
  it('clamps to MIN_FRACTION and never goes below', () => {
    const next = resizeAdjacent([1, 1], 0, 1000, 200); // absurd drag
    expect(next[1]!).toBeCloseTo(MIN_FRACTION);
    expect(next[0]!).toBeCloseTo(2 - MIN_FRACTION);
  });
  it('returns input unchanged for an out-of-range boundary or zero size', () => {
    const arr = [1, 1, 1];
    expect(resizeAdjacent(arr, 2, 10, 300)).toBe(arr); // index === len-1
    expect(resizeAdjacent(arr, -1, 10, 300)).toBe(arr);
    expect(resizeAdjacent(arr, 0, 10, 0)).toBe(arr); // zero total px
  });
});

describe('bumpTrack', () => {
  it('grows a track and takes from the next neighbour', () => {
    expect(bumpTrack([1, 1, 1], 0, 0.5)).toEqual([1.5, 0.5, 1]);
  });
  it('takes from the previous neighbour when index is last', () => {
    expect(bumpTrack([1, 1], 1, 0.5)).toEqual([0.5, 1.5]);
  });
  it('clamps to MIN_FRACTION', () => {
    const out = bumpTrack([1, 1], 0, 10);
    expect(out[0]).toBeCloseTo(2 - MIN_FRACTION);
    expect(out[1]).toBeCloseTo(MIN_FRACTION);
  });
  it('is a no-op with a single track', () => {
    const arr = [1];
    expect(bumpTrack(arr, 0, 0.5)).toBe(arr);
  });
});

describe('slot mapping', () => {
  it('round-trips slot <-> rc', () => {
    expect(slotToRC(0, 3)).toEqual({ r: 0, c: 0 });
    expect(slotToRC(4, 3)).toEqual({ r: 1, c: 1 });
    expect(rcToSlot(1, 1, 3)).toBe(4);
  });
});

describe('neighborSlot', () => {
  // 3x3 grid, 7 tiles (slots 0..6 occupied; 7,8 empty).
  const cols = 3;
  const rows = 3;
  const count = 7;
  it('moves within bounds', () => {
    expect(neighborSlot(0, 'right', cols, rows, count)).toBe(1);
    expect(neighborSlot(0, 'down', cols, rows, count)).toBe(3);
    expect(neighborSlot(4, 'left', cols, rows, count)).toBe(3);
    expect(neighborSlot(4, 'up', cols, rows, count)).toBe(1);
  });
  it('returns null at an edge', () => {
    expect(neighborSlot(0, 'left', cols, rows, count)).toBeNull();
    expect(neighborSlot(0, 'up', cols, rows, count)).toBeNull();
    expect(neighborSlot(2, 'right', cols, rows, count)).toBeNull();
  });
  it('returns null when moving into a trailing empty cell', () => {
    // slot 6 is bottom-left; moving right → slot 7 which is empty (>= count).
    expect(neighborSlot(6, 'right', cols, rows, count)).toBeNull();
    // slot 5 down → slot 8 empty.
    expect(neighborSlot(5, 'down', cols, rows, count)).toBeNull();
  });
});

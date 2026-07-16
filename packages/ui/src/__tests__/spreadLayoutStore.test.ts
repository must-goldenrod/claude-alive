import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadSpreadLayout,
  saveSpreadLayout,
  reconcileLayout,
  type SpreadLayout,
} from '../views/chat/spreadLayoutStore';

const KEY = 'claude-alive:spread-layout';

/** A hermetic in-memory Storage — the ambient localStorage under vitest is a
 *  partial node stub missing removeItem/clear, so we inject a complete one. */
function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

describe('spreadLayoutStore persistence', () => {
  beforeEach(() => vi.stubGlobal('localStorage', makeStorage()));

  it('round-trips a valid layout', () => {
    const layout: SpreadLayout = {
      cols: 2,
      rows: 1,
      colFractions: [1.5, 0.5],
      rowFractions: [1],
      order: ['a', 'b'],
    };
    saveSpreadLayout(layout);
    expect(loadSpreadLayout()).toEqual(layout);
  });

  it('returns null when absent', () => {
    expect(loadSpreadLayout()).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    localStorage.setItem(KEY, '{ not json');
    expect(loadSpreadLayout()).toBeNull();
  });

  it('rejects a layout whose fraction length disagrees with cols/rows', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ cols: 3, rows: 1, colFractions: [1, 1], rowFractions: [1], order: [] }),
    );
    expect(loadSpreadLayout()).toBeNull();
  });

  it('rejects non-positive fractions', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ cols: 2, rows: 1, colFractions: [1, 0], rowFractions: [1], order: [] }),
    );
    expect(loadSpreadLayout()).toBeNull();
  });
});

describe('reconcileLayout', () => {
  it('builds a default equal grid when there is no prior layout', () => {
    const l = reconcileLayout(null, ['a', 'b', 'c']);
    expect(l).toEqual({
      cols: 2,
      rows: 2,
      colFractions: [1, 1],
      rowFractions: [1, 1],
      order: ['a', 'b', 'c'],
    });
  });

  it('keeps fractions when the axis size is unchanged', () => {
    const prev: SpreadLayout = {
      cols: 2,
      rows: 1,
      colFractions: [1.7, 0.3],
      rowFractions: [1],
      order: ['a', 'b'],
    };
    // still 2 tabs → 2x1 grid, fractions preserved.
    const l = reconcileLayout(prev, ['a', 'b']);
    expect(l.colFractions).toEqual([1.7, 0.3]);
    expect(l.order).toEqual(['a', 'b']);
  });

  it('resets fractions for an axis whose size changed', () => {
    const prev: SpreadLayout = {
      cols: 2,
      rows: 1,
      colFractions: [1.7, 0.3],
      rowFractions: [1],
      order: ['a', 'b'],
    };
    // add a 3rd tab → grid becomes 2x2, so rows changed (1→2) → rowFractions reset,
    // cols unchanged (2) → colFractions preserved.
    const l = reconcileLayout(prev, ['a', 'b', 'c']);
    expect(l.cols).toBe(2);
    expect(l.rows).toBe(2);
    expect(l.colFractions).toEqual([1.7, 0.3]);
    expect(l.rowFractions).toEqual([1, 1]);
  });

  it('drops closed tabs and appends new ones, preserving surviving order', () => {
    const prev: SpreadLayout = {
      cols: 2,
      rows: 2,
      colFractions: [1, 1],
      rowFractions: [1, 1],
      order: ['a', 'b', 'c'],
    };
    // close 'b', open 'd' and 'e'.
    const l = reconcileLayout(prev, ['a', 'c', 'd', 'e']);
    expect(l.order).toEqual(['a', 'c', 'd', 'e']);
  });
});

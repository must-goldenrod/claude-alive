/**
 * Persists the user-adjusted Spread View layout (track sizes + tile order) to
 * localStorage so a refresh restores it. Mirrors openTabsStore: try/catch,
 * shape validation, silent fallback. Only layout metadata is stored — never
 * terminal content.
 */
import { defaultGrid, makeEqualFractions } from './spreadLayout';

const STORAGE_KEY = 'claude-alive:spread-layout';

export interface SpreadLayout {
  cols: number;
  rows: number;
  colFractions: number[]; // length === cols
  rowFractions: number[]; // length === rows
  order: string[]; // tabIds in slot (row-major) order
}

function isValidFractionArray(v: unknown, len: number): v is number[] {
  return (
    Array.isArray(v) &&
    v.length === len &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
  );
}

/** Load the persisted layout, or null if absent/corrupt. */
export function loadSpreadLayout(): SpreadLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SpreadLayout>;
    if (
      !p ||
      typeof p.cols !== 'number' ||
      typeof p.rows !== 'number' ||
      !isValidFractionArray(p.colFractions, p.cols) ||
      !isValidFractionArray(p.rowFractions, p.rows) ||
      !Array.isArray(p.order) ||
      !p.order.every((id) => typeof id === 'string')
    ) {
      return null;
    }
    return {
      cols: p.cols,
      rows: p.rows,
      colFractions: p.colFractions,
      rowFractions: p.rowFractions,
      order: p.order,
    };
  } catch {
    return null;
  }
}

/** Persist the layout. Fails silently if localStorage is unavailable/full. */
export function saveSpreadLayout(layout: SpreadLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // private mode / quota — non-fatal.
  }
}

/**
 * Reconcile a stored layout against the current tab set:
 * - grid dims come from the tab count; a track's fractions are kept only if that
 *   axis' size is unchanged, else reset to equal.
 * - `order` keeps surviving tabs in their prior slot order, drops closed tabs,
 *   and appends newly-opened tabs at the end.
 * Pure — the caller persists the result.
 */
export function reconcileLayout(prev: SpreadLayout | null, tabIds: string[]): SpreadLayout {
  const { cols, rows } = defaultGrid(tabIds.length);

  const colFractions =
    prev && prev.cols === cols && prev.colFractions.length === cols
      ? prev.colFractions.slice()
      : makeEqualFractions(cols);
  const rowFractions =
    prev && prev.rows === rows && prev.rowFractions.length === rows
      ? prev.rowFractions.slice()
      : makeEqualFractions(rows);

  const present = new Set(tabIds);
  const kept = prev ? prev.order.filter((id) => present.has(id)) : [];
  const keptSet = new Set(kept);
  const appended = tabIds.filter((id) => !keptSet.has(id));
  const order = [...kept, ...appended];

  return { cols, rows, colFractions, rowFractions, order };
}

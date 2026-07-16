/**
 * Pure grid math for Spread View's resizable tiling grid.
 *
 * The grid is driven by two fraction arrays (one per axis) mapped to CSS
 * `grid-template-{columns,rows}` as `<f>fr` tracks. Tiles occupy slots in
 * row-major order. All functions here are side-effect free so they can be unit
 * tested and reused by the store's reconcile logic.
 */

export type Direction = 'left' | 'right' | 'up' | 'down';

/** Smallest a single track may shrink to (in fr units) so a tile never vanishes. */
export const MIN_FRACTION = 0.2;

/** Grid dimensions for `n` tiles: a near-square, columns-first. */
export function defaultGrid(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 1, rows: 1 };
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows };
}

/** `count` equal tracks (each 1fr). */
export function makeEqualFractions(count: number): number[] {
  return Array.from({ length: Math.max(1, count) }, () => 1);
}

/** Map a fraction array to a CSS grid-template value (`"1fr 2fr 1fr"`). */
export function fractionsToTemplate(fractions: number[]): string {
  const list = fractions.length > 0 ? fractions : [1];
  return list.map((f) => `${f}fr`).join(' ');
}

/**
 * Move the boundary between track `index` and `index + 1` by `deltaPx`.
 * Converts px to fr using the axis total size, clamps both adjacent tracks to
 * MIN_FRACTION, and preserves their combined size. Returns a new array; returns
 * the input unchanged if the boundary index is out of range or sizing is zero.
 */
export function resizeAdjacent(
  fractions: number[],
  index: number,
  deltaPx: number,
  totalPx: number,
): number[] {
  if (index < 0 || index >= fractions.length - 1) return fractions;
  if (!(totalPx > 0)) return fractions;
  const totalFr = fractions.reduce((s, f) => s + f, 0);
  if (!(totalFr > 0)) return fractions;

  const deltaFr = (deltaPx / totalPx) * totalFr;
  const a = fractions[index]!;
  const b = fractions[index + 1]!;
  const pair = a + b;
  // Clamp so neither side drops below MIN_FRACTION while keeping a+b constant.
  let nextA = a + deltaFr;
  nextA = Math.max(MIN_FRACTION, Math.min(pair - MIN_FRACTION, nextA));
  const nextB = pair - nextA;

  const next = fractions.slice();
  next[index] = nextA;
  next[index + 1] = nextB;
  return next;
}

/**
 * Grow/shrink track `index` by `deltaFr`, taking the opposite amount from a
 * neighbour (the next track, or the previous one if `index` is last). Both
 * clamped to MIN_FRACTION so the pair sum is preserved. Used by the keyboard
 * resize shortcuts. Returns a new array; unchanged if there is no neighbour.
 */
export function bumpTrack(fractions: number[], index: number, deltaFr: number): number[] {
  if (index < 0 || index >= fractions.length || fractions.length < 2) return fractions;
  const neighbor = index < fractions.length - 1 ? index + 1 : index - 1;
  const cur = fractions[index]!;
  const nb = fractions[neighbor]!;
  const pair = cur + nb;
  let next = cur + deltaFr;
  next = Math.max(MIN_FRACTION, Math.min(pair - MIN_FRACTION, next));
  const out = fractions.slice();
  out[index] = next;
  out[neighbor] = pair - next;
  return out;
}

/** Slot index → row/column (row-major). */
export function slotToRC(slot: number, cols: number): { r: number; c: number } {
  const safeCols = Math.max(1, cols);
  return { r: Math.floor(slot / safeCols), c: slot % safeCols };
}

/** Row/column → slot index (row-major). */
export function rcToSlot(r: number, c: number, cols: number): number {
  return r * Math.max(1, cols) + c;
}

/**
 * Neighbouring occupied slot in a direction, or null at an edge / empty cell.
 * `count` is the number of occupied slots (tiles) so we never focus/swap into a
 * trailing empty cell of a non-full last row.
 */
export function neighborSlot(
  slot: number,
  dir: Direction,
  cols: number,
  rows: number,
  count: number,
): number | null {
  const { r, c } = slotToRC(slot, cols);
  let nr = r;
  let nc = c;
  if (dir === 'left') nc -= 1;
  else if (dir === 'right') nc += 1;
  else if (dir === 'up') nr -= 1;
  else nr += 1;
  if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return null;
  const target = rcToSlot(nr, nc, cols);
  if (target < 0 || target >= count) return null;
  return target;
}

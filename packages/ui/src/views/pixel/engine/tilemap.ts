import { DEFAULT_COLS, DEFAULT_ROWS } from './constants';

export const TileType = {
  VOID: 0, FLOOR: 1, WALL: 2, DESK: 3, COMPUTER: 4,
  CHAIR: 5, PLANT: 6, BOOKSHELF: 7, SOFA: 8, COFFEE_MACHINE: 9,
  WHITEBOARD: 10, MEETING_TABLE: 11, SNACK_MACHINE: 12, POSTER: 13, CLOCK: 14, RUG: 15,
} as const;
export type TileTypeValue = (typeof TileType)[keyof typeof TileType];

export interface TileMap {
  cols: number;
  rows: number;
  tiles: TileTypeValue[];
}

function tileIndex(map: TileMap, col: number, row: number): number {
  return row * map.cols + col;
}

function inBounds(map: TileMap, col: number, row: number): boolean {
  return col >= 0 && col < map.cols && row >= 0 && row < map.rows;
}

function getTile(map: TileMap, col: number, row: number): TileTypeValue {
  if (!inBounds(map, col, row)) return TileType.VOID;
  return map.tiles[tileIndex(map, col, row)];
}

/** Create office with 4 zones (A/B/C/D), corridors, and furniture */
export function createDefaultOffice(): TileMap {
  const cols = DEFAULT_COLS;
  const rows = DEFAULT_ROWS;
  const tiles: TileTypeValue[] = new Array(cols * rows).fill(TileType.FLOOR);

  const set = (c: number, r: number, t: TileTypeValue) => {
    tiles[r * cols + c] = t;
  };

  // --- Outer walls ---
  for (let c = 0; c < cols; c++) {
    set(c, 0, TileType.WALL);
    set(c, rows - 1, TileType.WALL);
  }
  for (let r = 0; r < rows; r++) {
    set(0, r, TileType.WALL);
    set(cols - 1, r, TileType.WALL);
  }

  // --- Interior walls ---
  // Vertical walls: col 19 and col 21, rows 1-10 and 13-22
  for (const c of [19, 21]) {
    for (let r = 1; r <= 10; r++) set(c, r, TileType.WALL);
    for (let r = 13; r <= 22; r++) set(c, r, TileType.WALL);
  }
  // Horizontal walls: row 11 and row 13, cols 1-18 and 22-38
  for (const r of [11, 13]) {
    for (let c = 1; c <= 18; c++) set(c, r, TileType.WALL);
    for (let c = 22; c <= 38; c++) set(c, r, TileType.WALL);
  }

  // --- Doors (FLOOR gaps in interior walls) ---
  // Vertical corridor doors
  set(19, 6, TileType.FLOOR);   // A → corridor
  set(21, 6, TileType.FLOOR);   // corridor → B
  set(19, 17, TileType.FLOOR);  // C → corridor
  set(21, 17, TileType.FLOOR);  // corridor → D
  // Horizontal corridor doors
  set(10, 11, TileType.FLOOR);  // A → horizontal corridor
  set(30, 11, TileType.FLOOR);  // B → horizontal corridor
  set(10, 13, TileType.FLOOR);  // horizontal corridor → C
  set(30, 13, TileType.FLOOR);  // horizontal corridor → D

  // --- Vertical corridor: col 20 always FLOOR (already FLOOR from fill) ---

  // === Zone A furniture (cols 1-18, rows 1-10) ===
  // Desk clusters
  const zoneAClusters = [
    { cols: [3, 4, 5], deskRow: 3, chairRow: 4 },
    { cols: [10, 11, 12], deskRow: 3, chairRow: 4 },
    { cols: [3, 4, 5], deskRow: 7, chairRow: 8 },
    { cols: [10, 11, 12], deskRow: 7, chairRow: 8 },
  ];
  for (const cluster of zoneAClusters) {
    set(cluster.cols[0], cluster.deskRow, TileType.DESK);
    set(cluster.cols[1], cluster.deskRow, TileType.COMPUTER);
    set(cluster.cols[2], cluster.deskRow, TileType.DESK);
    for (const c of cluster.cols) set(c, cluster.chairRow, TileType.CHAIR);
  }
  // Plants
  for (const [c, r] of [[2, 2], [8, 2], [14, 2], [16, 6]] as const) set(c, r, TileType.PLANT);
  // Bookshelves
  set(17, 1, TileType.BOOKSHELF);
  set(18, 1, TileType.BOOKSHELF);

  // === Zone B furniture (cols 22-38, rows 1-10) ===
  const zoneBClusters = [
    { cols: [24, 25, 26], deskRow: 3, chairRow: 4 },
    { cols: [31, 32, 33], deskRow: 3, chairRow: 4 },
    { cols: [24, 25, 26], deskRow: 7, chairRow: 8 },
    { cols: [31, 32, 33], deskRow: 7, chairRow: 8 },
  ];
  for (const cluster of zoneBClusters) {
    set(cluster.cols[0], cluster.deskRow, TileType.DESK);
    set(cluster.cols[1], cluster.deskRow, TileType.COMPUTER);
    set(cluster.cols[2], cluster.deskRow, TileType.DESK);
    for (const c of cluster.cols) set(c, cluster.chairRow, TileType.CHAIR);
  }
  // Plants
  for (const [c, r] of [[23, 2], [29, 2], [35, 2]] as const) set(c, r, TileType.PLANT);
  // Bookshelves
  set(37, 1, TileType.BOOKSHELF);
  set(38, 1, TileType.BOOKSHELF);

  // === Zone C furniture (cols 1-18, rows 13-22) ===
  const zoneCClusters = [
    { cols: [3, 4, 5], deskRow: 15, chairRow: 16 },
    { cols: [10, 11, 12], deskRow: 15, chairRow: 16 },
    { cols: [3, 4, 5], deskRow: 19, chairRow: 20 },
    { cols: [10, 11, 12], deskRow: 19, chairRow: 20 },
  ];
  for (const cluster of zoneCClusters) {
    set(cluster.cols[0], cluster.deskRow, TileType.DESK);
    set(cluster.cols[1], cluster.deskRow, TileType.COMPUTER);
    set(cluster.cols[2], cluster.deskRow, TileType.DESK);
    for (const c of cluster.cols) set(c, cluster.chairRow, TileType.CHAIR);
  }
  // Plants
  set(2, 14, TileType.PLANT);
  set(8, 14, TileType.PLANT);
  // Whiteboards
  set(15, 14, TileType.WHITEBOARD);
  set(16, 14, TileType.WHITEBOARD);

  // === Zone D / Break Room (cols 22-38, rows 13-22) ===
  // Sofa
  for (const c of [24, 25, 26]) set(c, 15, TileType.SOFA);
  // Rug
  for (const c of [24, 25, 26]) {
    set(c, 17, TileType.RUG);
    set(c, 18, TileType.RUG);
  }
  // Coffee & snack machines
  set(35, 14, TileType.COFFEE_MACHINE);
  set(37, 14, TileType.SNACK_MACHINE);
  // Meeting table
  for (const c of [30, 31, 32]) {
    set(c, 18, TileType.MEETING_TABLE);
    set(c, 19, TileType.MEETING_TABLE);
  }
  // Plants
  set(23, 14, TileType.PLANT);
  set(23, 21, TileType.PLANT);
  set(37, 21, TileType.PLANT);
  // Poster on wall row 13
  set(28, 13, TileType.POSTER);
  set(29, 13, TileType.POSTER);
  // Clock on wall row 13
  set(35, 13, TileType.CLOCK);

  return { cols, rows, tiles };
}

/** Check if a tile is walkable */
export function isWalkable(map: TileMap, col: number, row: number): boolean {
  if (!inBounds(map, col, row)) return false;
  const tile = getTile(map, col, row);
  return tile === TileType.FLOOR || tile === TileType.CHAIR || tile === TileType.RUG;
}

/** BFS pathfinding - returns array of {col, row} or null if no path */
export function findPath(
  map: TileMap,
  from: { col: number; row: number },
  to: { col: number; row: number },
  blocked?: Set<string>,
): { col: number; row: number }[] | null {
  if (!isWalkable(map, from.col, from.row) || !isWalkable(map, to.col, to.row)) {
    return null;
  }
  if (from.col === to.col && from.row === to.row) {
    return [{ col: to.col, row: to.row }];
  }

  const key = (c: number, r: number) => `${c},${r}`;
  const visited = new Set<string>();
  visited.add(key(from.col, from.row));

  const queue: { col: number; row: number; path: { col: number; row: number }[] }[] = [
    { col: from.col, row: from.row, path: [] },
  ];

  const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const [dc, dr] of dirs) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      const k = key(nc, nr);

      if (visited.has(k)) continue;
      if (!isWalkable(map, nc, nr)) continue;
      if (blocked?.has(k)) continue;

      visited.add(k);
      const newPath = [...current.path, { col: nc, row: nr }];

      if (nc === to.col && nr === to.row) {
        return newPath;
      }

      queue.push({ col: nc, row: nr, path: newPath });
    }
  }

  return null;
}

/** Find nearest walkable tile to a position */
export function findNearestWalkable(
  map: TileMap,
  col: number,
  row: number,
): { col: number; row: number } | null {
  if (isWalkable(map, col, row)) return { col, row };

  const visited = new Set<string>();
  const key = (c: number, r: number) => `${c},${r}`;
  visited.add(key(col, row));

  const queue: { col: number; row: number }[] = [{ col, row }];
  const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const [dc, dr] of dirs) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      const k = key(nc, nr);

      if (visited.has(k)) continue;
      if (!inBounds(map, nc, nr)) continue;
      visited.add(k);

      if (isWalkable(map, nc, nr)) return { col: nc, row: nr };
      queue.push({ col: nc, row: nr });
    }
  }

  return null;
}

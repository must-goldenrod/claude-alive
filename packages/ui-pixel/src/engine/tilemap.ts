import { DEFAULT_COLS, DEFAULT_ROWS } from './constants';

export const TileType = { VOID: 0, FLOOR: 1, WALL: 2 } as const;
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

/** Create a default office layout */
export function createDefaultOffice(): TileMap {
  const cols = DEFAULT_COLS;
  const rows = DEFAULT_ROWS;
  const tiles: TileTypeValue[] = new Array(cols * rows).fill(TileType.FLOOR);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const i = r * cols + c;
      // Outer walls
      if (c === 0 || c === cols - 1 || r === 0 || r === rows - 1) {
        tiles[i] = TileType.WALL;
        continue;
      }
      // Desk rows: rows 3 and 7, columns 3-7 and 12-16
      if ((r === 3 || r === 7) && ((c >= 3 && c <= 7) || (c >= 12 && c <= 16))) {
        tiles[i] = TileType.WALL;
      }
    }
  }

  return { cols, rows, tiles };
}

/** Check if a tile is walkable */
export function isWalkable(map: TileMap, col: number, row: number): boolean {
  return inBounds(map, col, row) && getTile(map, col, row) === TileType.FLOOR;
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

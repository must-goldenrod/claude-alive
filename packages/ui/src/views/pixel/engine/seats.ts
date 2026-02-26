import type { TileMap } from './tilemap';
import { TileType, isWalkable } from './tilemap';

export type Direction = 'down' | 'up' | 'left' | 'right';
export type Zone = 'A' | 'B' | 'C' | 'D' | null;

export interface Seat {
  col: number;
  row: number;
  facing: Direction;
  zone: Zone;
  assignedTo: string | null; // character id
}

// Desk cluster definitions (must match tilemap.ts createDefaultOffice)
const CLUSTERS: { zone: 'A' | 'B' | 'C' | 'D'; startCol: number; row: number }[] = [
  { zone: 'A', startCol: 3, row: 3 },
  { zone: 'B', startCol: 12, row: 3 },
  { zone: 'C', startCol: 3, row: 8 },
  { zone: 'D', startCol: 12, row: 8 },
];

function isDeskOrComputer(tile: number): boolean {
  return tile === TileType.DESK || tile === TileType.COMPUTER;
}

/** Determine which zone a desk tile belongs to */
function getZoneForDesk(col: number, row: number): Zone {
  for (const c of CLUSTERS) {
    if (row === c.row && col >= c.startCol && col < c.startCol + 3) {
      return c.zone;
    }
  }
  return null;
}

/** Find seats: walkable floor tiles adjacent to DESK/COMPUTER tiles */
export function findSeats(tileMap: TileMap): Seat[] {
  const seats: Seat[] = [];
  const { cols, rows, tiles } = tileMap;

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (!isWalkable(tileMap, c, r)) continue;

      const dirs: [number, number, Direction][] = [
        [0, -1, 'up'],
        [0, 1, 'down'],
        [-1, 0, 'left'],
        [1, 0, 'right'],
      ];

      for (const [dc, dr, facing] of dirs) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc === 0 || nc === cols - 1 || nr === 0 || nr === rows - 1) continue;
        if (isDeskOrComputer(tiles[nr * cols + nc])) {
          const zone = getZoneForDesk(nc, nr);
          seats.push({ col: c, row: r, facing, zone, assignedTo: null });
          break;
        }
      }
    }
  }

  return seats;
}

/** Assign the nearest free seat, preferring seats in the given zone */
export function assignNearestSeat(
  seats: Seat[],
  characterId: string,
  fromCol: number,
  fromRow: number,
  preferZone?: Zone,
): Seat | null {
  // Try preferred zone first, then fall back to any zone
  const zones = preferZone ? [preferZone, null] : [null];

  for (const targetZone of zones) {
    let best: Seat | null = null;
    let bestDist = Infinity;

    for (const seat of seats) {
      if (seat.assignedTo !== null) continue;
      if (targetZone !== null && seat.zone !== targetZone) continue;
      const dist = Math.abs(seat.col - fromCol) + Math.abs(seat.row - fromRow);
      if (dist < bestDist) {
        bestDist = dist;
        best = seat;
      }
    }

    if (best) {
      best.assignedTo = characterId;
      return best;
    }
  }

  return null;
}

/** Free a seat previously assigned to a character */
export function freeSeat(seats: Seat[], characterId: string): void {
  for (const seat of seats) {
    if (seat.assignedTo === characterId) {
      seat.assignedTo = null;
    }
  }
}

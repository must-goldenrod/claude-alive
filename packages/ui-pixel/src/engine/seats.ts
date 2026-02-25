import type { TileMap } from './tilemap';
import { TileType, isWalkable } from './tilemap';

export type Direction = 'down' | 'up' | 'left' | 'right';

export interface Seat {
  col: number;
  row: number;
  facing: Direction;
  assignedTo: string | null; // character id
}

/**
 * Find seats in the tilemap: walkable floor tiles adjacent to desk (WALL) tiles
 * that are not outer walls. A seat faces toward the desk it's next to.
 */
export function findSeats(tileMap: TileMap): Seat[] {
  const seats: Seat[] = [];
  const { cols, rows, tiles } = tileMap;

  // Check each floor tile to see if it's adjacent to an interior wall (desk)
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (!isWalkable(tileMap, c, r)) continue;

      // Check cardinal neighbors for interior walls (desks)
      const dirs: [number, number, Direction][] = [
        [0, -1, 'up'],    // tile above is desk -> face up
        [0, 1, 'down'],   // tile below is desk -> face down
        [-1, 0, 'left'],  // tile left is desk -> face left
        [1, 0, 'right'],  // tile right is desk -> face right
      ];

      for (const [dc, dr, facing] of dirs) {
        const nc = c + dc;
        const nr = r + dr;
        // Skip outer walls (they aren't desks)
        if (nc === 0 || nc === cols - 1 || nr === 0 || nr === rows - 1) continue;
        if (tiles[nr * cols + nc] === TileType.WALL) {
          seats.push({ col: c, row: r, facing, assignedTo: null });
          break; // One seat per tile
        }
      }
    }
  }

  return seats;
}

/** Assign the nearest free seat to a character. Returns the seat or null if none free. */
export function assignNearestSeat(
  seats: Seat[],
  characterId: string,
  fromCol: number,
  fromRow: number,
): Seat | null {
  let best: Seat | null = null;
  let bestDist = Infinity;

  for (const seat of seats) {
    if (seat.assignedTo !== null) continue;
    const dist = Math.abs(seat.col - fromCol) + Math.abs(seat.row - fromRow);
    if (dist < bestDist) {
      bestDist = dist;
      best = seat;
    }
  }

  if (best) {
    best.assignedTo = characterId;
  }
  return best;
}

/** Free a seat previously assigned to a character */
export function freeSeat(seats: Seat[], characterId: string): void {
  for (const seat of seats) {
    if (seat.assignedTo === characterId) {
      seat.assignedTo = null;
    }
  }
}

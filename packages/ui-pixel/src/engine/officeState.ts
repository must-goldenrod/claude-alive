import type { Entity } from './renderer';
import type { TileMap } from './tilemap';
import type { Camera } from './camera';
import type { Seat } from './seats';
import type { Character } from './character';
import { createDefaultOffice } from './tilemap';
import { createCamera } from './camera';
import { findSeats, assignNearestSeat, freeSeat } from './seats';
import { createCharacter, updateCharacter, assignSeat } from './character';
import { findNearestWalkable } from './tilemap';

// ── State ───────────────────────────────────────────────────────────────

export interface OfficeState {
  tileMap: TileMap;
  characters: Map<string, Character>;
  seats: Seat[];
  camera: Camera;
  selectedCharacterId: string | null;
  nextPaletteIndex: number;
}

export function createOfficeState(): OfficeState {
  const tileMap = createDefaultOffice();
  const seats = findSeats(tileMap);

  return {
    tileMap,
    characters: new Map(),
    seats,
    camera: createCamera(),
    selectedCharacterId: null,
    nextPaletteIndex: 0,
  };
}

// ── Spawn / Despawn ─────────────────────────────────────────────────────

export function spawnCharacter(state: OfficeState, sessionId: string): Character {
  const paletteIndex = state.nextPaletteIndex;
  state.nextPaletteIndex++;

  // Find a walkable spawn point (center-ish of the map)
  const centerCol = Math.floor(state.tileMap.cols / 2);
  const centerRow = Math.floor(state.tileMap.rows / 2);
  const spawn = findNearestWalkable(state.tileMap, centerCol, centerRow) ?? { col: 2, row: 2 };

  const id = `char-${sessionId}`;
  const char = createCharacter(id, sessionId, paletteIndex, spawn.col, spawn.row);

  // Try to assign a seat
  const seat = assignNearestSeat(state.seats, id, spawn.col, spawn.row);
  if (seat) {
    assignSeat(char, seat.col, seat.row, seat.facing, state.tileMap);
  }

  state.characters.set(sessionId, char);
  return char;
}

export function despawnCharacter(state: OfficeState, sessionId: string): void {
  const char = state.characters.get(sessionId);
  if (!char) return;

  freeSeat(state.seats, char.id);
  state.characters.delete(sessionId);
}

// ── Update ──────────────────────────────────────────────────────────────

export function updateOffice(state: OfficeState, dt: number): void {
  for (const char of state.characters.values()) {
    updateCharacter(char, dt, state.tileMap);
  }
}

// ── Get entities for rendering ──────────────────────────────────────────

export function getEntities(state: OfficeState): Entity[] {
  const entities: Entity[] = [];
  for (const char of state.characters.values()) {
    entities.push(char);
  }
  return entities;
}

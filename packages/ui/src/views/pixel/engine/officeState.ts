import type { Entity } from './renderer';
import type { TileMap } from './tilemap';
import type { Camera } from './camera';
import type { Seat } from './seats';
import type { Character } from './character';
import type { MatrixEffect } from './matrixEffect';
import { createDefaultOffice } from './tilemap';
import { createCamera } from './camera';
import { findSeats, assignNearestSeat, freeSeat } from './seats';
import { createCharacter, updateCharacter, assignSeat, makeEffectEntity } from './character';
import { findNearestWalkable } from './tilemap';
import { createMatrixEffect, updateMatrixEffect } from './matrixEffect';

// ── State ───────────────────────────────────────────────────────────────

export interface ActiveEffect {
  sessionId: string;
  character: Character;   // kept around for position/rendering during effect
  effect: MatrixEffect;
}

export interface OfficeState {
  tileMap: TileMap;
  characters: Map<string, Character>;
  effects: ActiveEffect[];
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
    effects: [],
    seats,
    camera: createCamera(),
    selectedCharacterId: null,
    nextPaletteIndex: 0,
  };
}

// ── Spawn / Despawn ─────────────────────────────────────────────────────

export function spawnCharacter(state: OfficeState, sessionId: string): Character {
  // If already exists, just return it
  const existing = state.characters.get(sessionId);
  if (existing) return existing;

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

  // Start spawn effect
  state.effects.push({
    sessionId,
    character: char,
    effect: createMatrixEffect('spawn'),
  });

  return char;
}

export function despawnCharacter(state: OfficeState, sessionId: string): void {
  const char = state.characters.get(sessionId);
  if (!char) return;

  freeSeat(state.seats, char.id);
  state.characters.delete(sessionId);

  // Start despawn effect (keep character reference for rendering)
  state.effects.push({
    sessionId,
    character: char,
    effect: createMatrixEffect('despawn'),
  });
}

// ── Update ──────────────────────────────────────────────────────────────

export function updateOffice(state: OfficeState, dt: number): void {
  for (const char of state.characters.values()) {
    updateCharacter(char, dt, state.tileMap);
  }

  // Update active effects, remove completed ones
  for (let i = state.effects.length - 1; i >= 0; i--) {
    const done = updateMatrixEffect(state.effects[i].effect, dt);
    if (done) {
      state.effects.splice(i, 1);
    }
  }
}

// ── Get entities for rendering ──────────────────────────────────────────

export function getEntities(state: OfficeState): Entity[] {
  const entities: Entity[] = [];

  for (const char of state.characters.values()) {
    const activeEffect = state.effects.find(
      e => e.sessionId === char.sessionId,
    );
    if (activeEffect) {
      // Render character with matrix overlay (spawn effect)
      entities.push(makeEffectEntity(char, activeEffect.effect));
    } else {
      entities.push(char);
    }
  }

  // Despawn effects (character already removed from map)
  for (const ae of state.effects) {
    if (state.characters.has(ae.sessionId)) continue;
    // This is a despawn effect — character is gone from the map
    entities.push(makeEffectEntity(ae.character, ae.effect));
  }

  return entities;
}

// ── Matrix spawn/despawn effect ─────────────────────────────────────────
// Digital rain that reveals (spawn) or consumes (despawn) a character.

export interface MatrixColumn {
  chars: string[];   // random characters for rain trail
  offset: number;    // random start offset (0..1)
}

export interface MatrixEffect {
  type: 'spawn' | 'despawn';
  progress: number;  // 0 to 1
  duration: number;  // seconds
  columns: MatrixColumn[];
}

// Characters used in the rain
const MATRIX_CHARS = '0123456789ABCDEF@#$%&*+=-~';

const MATRIX_GREEN = '#00FF41';
const MATRIX_GREEN_DIM = '#00802080';
const COLUMN_COUNT = 5; // columns per character width
const TRAIL_LENGTH = 4; // how many chars in each rain trail

function randomChar(): string {
  return MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
}

export function createMatrixEffect(type: 'spawn' | 'despawn'): MatrixEffect {
  const columns: MatrixColumn[] = [];
  for (let i = 0; i < COLUMN_COUNT; i++) {
    const chars: string[] = [];
    for (let j = 0; j < TRAIL_LENGTH; j++) {
      chars.push(randomChar());
    }
    columns.push({
      chars,
      offset: Math.random() * 0.3, // stagger columns slightly
    });
  }

  return {
    type,
    progress: 0,
    duration: 0.5,
    columns,
  };
}

/** Advance the effect. Returns true when complete. */
export function updateMatrixEffect(effect: MatrixEffect, dt: number): boolean {
  effect.progress += dt / effect.duration;

  // Randomize a few trail chars each frame for flicker
  for (const col of effect.columns) {
    const idx = Math.floor(Math.random() * col.chars.length);
    col.chars[idx] = randomChar();
  }

  return effect.progress >= 1;
}

/**
 * Render the matrix effect at the character's screen position.
 * Called INSTEAD of the character sprite during the effect.
 *
 * ctx is already translated to the entity's top-left corner in screen space.
 * width/height are the character's screen dimensions (already zoomed by caller? No --
 * we receive the base pixel dimensions and zoom factor).
 */
export function renderMatrixEffect(
  ctx: CanvasRenderingContext2D,
  effect: MatrixEffect,
  width: number,
  height: number,
  zoom: number,
): void {
  const w = width * zoom;
  const h = height * zoom;
  const p = Math.min(1, Math.max(0, effect.progress));

  // For spawn: rain sweeps down revealing character (character fades in behind)
  // For despawn: rain sweeps down consuming character (character fades out behind)
  // We just draw the rain overlay; the character is rendered separately with opacity

  const colWidth = w / COLUMN_COUNT;
  const charSize = Math.max(4, Math.floor(3 * zoom));

  ctx.save();

  for (let i = 0; i < effect.columns.length; i++) {
    const col = effect.columns[i];
    const colP = Math.min(1, Math.max(0, (p - col.offset) / (1 - col.offset)));

    // The "head" position of this rain column (0..1 maps to top..bottom of character)
    const headY = colP * (h + charSize * TRAIL_LENGTH);
    const cx = Math.floor(i * colWidth + colWidth / 2);

    for (let j = 0; j < col.chars.length; j++) {
      const cy = Math.floor(headY - j * charSize);
      if (cy < -charSize || cy > h) continue;

      // Brightness: head is brightest, tail fades
      const brightness = 1 - j / col.chars.length;
      if (j === 0) {
        // Lead character: bright white-green
        ctx.fillStyle = '#FFFFFF';
      } else {
        ctx.fillStyle = brightness > 0.5 ? MATRIX_GREEN : MATRIX_GREEN_DIM;
      }

      ctx.font = `${charSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(col.chars[j], cx, cy);
    }
  }

  ctx.restore();
}

/** Returns the character opacity during an effect (for blending) */
export function getEffectCharacterOpacity(effect: MatrixEffect): number {
  const p = Math.min(1, Math.max(0, effect.progress));
  if (effect.type === 'spawn') {
    // Character fades in as rain sweeps down
    return p;
  }
  // Character fades out as rain sweeps down
  return 1 - p;
}

import { DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, TILE_SIZE, DEFAULT_COLS, DEFAULT_ROWS } from './constants';

export interface Camera {
  x: number; // world X center (in pixels)
  y: number; // world Y center (in pixels)
  zoom: number; // integer zoom level
}

export function createCamera(): Camera {
  return {
    x: (DEFAULT_COLS * TILE_SIZE) / 2,
    y: (DEFAULT_ROWS * TILE_SIZE) / 2,
    zoom: DEFAULT_ZOOM,
  };
}

/** Convert screen coords to world coords */
export function screenToWorld(
  camera: Camera,
  screenX: number,
  screenY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: (screenX - canvasWidth / 2) / camera.zoom + camera.x,
    y: (screenY - canvasHeight / 2) / camera.zoom + camera.y,
  };
}

/** Convert world coords to screen coords */
export function worldToScreen(
  camera: Camera,
  worldX: number,
  worldY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: (worldX - camera.x) * camera.zoom + canvasWidth / 2,
    y: (worldY - camera.y) * camera.zoom + canvasHeight / 2,
  };
}

/** Clamp camera to keep the office visible */
export function clampCamera(
  camera: Camera,
  mapWidth: number,
  mapHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): Camera {
  const halfViewW = canvasWidth / (2 * camera.zoom);
  const halfViewH = canvasHeight / (2 * camera.zoom);

  let x = camera.x;
  let y = camera.y;

  // If the viewport is smaller than the map, clamp to edges
  if (halfViewW * 2 < mapWidth) {
    x = Math.max(halfViewW, Math.min(mapWidth - halfViewW, x));
  } else {
    x = mapWidth / 2;
  }

  if (halfViewH * 2 < mapHeight) {
    y = Math.max(halfViewH, Math.min(mapHeight - halfViewH, y));
  } else {
    y = mapHeight / 2;
  }

  return { x, y, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom)) };
}

import { useRef, useEffect, useCallback } from 'react';
import type { Camera } from '../engine/camera';
import type { TileMap } from '../engine/tilemap';
import type { Entity } from '../engine/renderer';
import { clampCamera, screenToWorld } from '../engine/camera';
import { createGameLoop } from '../engine/gameLoop';
import { renderFrame } from '../engine/renderer';
import { TILE_SIZE, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from '../engine/constants';

interface PixelCanvasProps {
  camera: React.MutableRefObject<Camera>;
  tileMap: TileMap;
  entities: React.MutableRefObject<Entity[]>;
  onTileClick?: (col: number, row: number) => void;
  onWorldClick?: (worldX: number, worldY: number) => void;
}

export default function PixelCanvas({ camera, tileMap, entities, onTileClick, onWorldClick }: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  const mapWidth = tileMap.cols * TILE_SIZE;
  const mapHeight = tileMap.rows * TILE_SIZE;

  // Resize canvas to fill viewport with DPR handling
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    resizeCanvas();

    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Game loop: update is a no-op for now (Phase 3-C will add logic)
    const loop = createGameLoop(
      () => {},
      () => {
        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.width / dpr;
        const cssH = canvas.height / dpr;
        camera.current = clampCamera(camera.current, mapWidth, mapHeight, cssW, cssH);
        // Reset transform and use CSS pixel coordinates
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderFrame(ctx, cssW, cssH, camera.current, tileMap, entities.current);
      },
    );

    loop.start();

    return () => {
      loop.stop();
      observer.disconnect();
    };
  }, [camera, tileMap, entities, mapWidth, mapHeight, resizeCanvas]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button === 0 || e.button === 1) {
        isPanning.current = true;
        isDragging.current = false;
        dragStart.current = { x: e.clientX, y: e.clientY };
        lastMouse.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isPanning.current) return;

      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };

      if (!isDragging.current) {
        const totalDx = e.clientX - dragStart.current.x;
        const totalDy = e.clientY - dragStart.current.y;
        if (Math.abs(totalDx) > 5 || Math.abs(totalDy) > 5) {
          isDragging.current = true;
        } else {
          return;
        }
      }

      camera.current = {
        ...camera.current,
        x: camera.current.x - dx / camera.current.zoom,
        y: camera.current.y - dy / camera.current.zoom,
      };
    },
    [camera],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const wasDragging = isDragging.current;
      isPanning.current = false;
      isDragging.current = false;

      if (!wasDragging && e.button === 0) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.width / dpr;
        const cssH = canvas.height / dpr;
        const world = screenToWorld(camera.current, screenX, screenY, cssW, cssH);
        if (onWorldClick) onWorldClick(world.x, world.y);
        if (onTileClick) {
          const col = Math.floor(world.x / TILE_SIZE);
          const row = Math.floor(world.y / TILE_SIZE);
          onTileClick(col, row);
        }
      }
    },
    [camera, onTileClick, onWorldClick],
  );

  // Native wheel listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.current.zoom + delta));
      camera.current = { ...camera.current, zoom: newZoom };
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [camera]);

  return (
    <canvas
      ref={canvasRef}
      className="pixel-canvas"
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { isPanning.current = false; isDragging.current = false; }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

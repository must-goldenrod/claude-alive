import { MAX_DELTA } from './constants';

export type UpdateFn = (dt: number) => void;
export type RenderFn = () => void;

export function createGameLoop(
  update: UpdateFn,
  render: RenderFn,
): { start: () => void; stop: () => void } {
  let running = false;
  let lastTime = 0;
  let rafId = 0;

  function loop(time: number) {
    if (!running) return;
    const dt = Math.min((time - lastTime) / 1000, MAX_DELTA);
    lastTime = time;
    update(dt);
    render();
    rafId = requestAnimationFrame(loop);
  }

  return {
    start() {
      running = true;
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}

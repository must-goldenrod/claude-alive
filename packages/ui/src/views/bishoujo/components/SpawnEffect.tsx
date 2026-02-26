import { useRef, useCallback } from 'react';
import { Graphics } from 'pixi.js';
import { useTick } from '@pixi/react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
}

interface SpawnEffectProps {
  x: number;
  y: number;
  active: boolean;
}

const COLORS = [0xffffff, 0xffeb3b, 0x81d4fa, 0xce93d8, 0xa5d6a7];
const MAX_PARTICLES = 20;

/**
 * Sparkle particle effect for spawn/despawn animations.
 * Renders directly as PixiJS Graphics.
 */
export function SpawnEffect({ x, y, active }: SpawnEffectProps) {
  const particles = useRef<Particle[]>([]);
  const spawnTimer = useRef(0);

  useTick((ticker) => {
    const dt = ticker.deltaMS / 1000;

    // Spawn new particles when active
    if (active) {
      spawnTimer.current += dt;
      while (spawnTimer.current > 0.05 && particles.current.length < MAX_PARTICLES) {
        spawnTimer.current -= 0.05;
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 60;
        particles.current.push({
          x: 0,
          y: 0,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 20,
          life: 0.6 + Math.random() * 0.4,
          maxLife: 0.6 + Math.random() * 0.4,
          size: 1.5 + Math.random() * 2.5,
          color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        });
      }
    } else {
      spawnTimer.current = 0;
    }

    // Update particles
    for (let i = particles.current.length - 1; i >= 0; i--) {
      const p = particles.current[i]!;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 40 * dt; // gravity
      p.life -= dt;
      if (p.life <= 0) {
        particles.current.splice(i, 1);
      }
    }
  });

  const draw = useCallback(
    (g: Graphics) => {
      g.clear();
      g.position.set(x, y);
      for (const p of particles.current) {
        const alpha = Math.max(0, p.life / p.maxLife);
        g.circle(p.x, p.y, p.size * alpha);
        g.fill({ color: p.color, alpha });
      }
    },
    [x, y],
  );

  return <pixiGraphics draw={draw} zIndex={100} />;
}

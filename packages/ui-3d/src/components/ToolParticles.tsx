import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ToolParticlesProps {
  position: [number, number, number];
  color: string;
  active: boolean;
}

const PARTICLE_COUNT = 24;
const MAX_HEIGHT = 2.5;

export function ToolParticles({ position, color, active }: ToolParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);

  // Initialize particle positions and velocities
  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const vel = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Random XZ spread around agent
      pos[i * 3] = (Math.random() - 0.5) * 0.8;
      pos[i * 3 + 1] = Math.random() * MAX_HEIGHT;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
      // Upward velocity variance
      vel[i] = 0.5 + Math.random() * 1.0;
    }
    return { positions: pos, velocities: vel };
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current || !active) return;
    const posAttr = pointsRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Move upward
      arr[i * 3 + 1] += velocities[i] * delta;

      // Respawn at base when reaching max height
      if (arr[i * 3 + 1] > MAX_HEIGHT) {
        arr[i * 3] = (Math.random() - 0.5) * 0.8;
        arr[i * 3 + 1] = 0;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
      }
    }
    posAttr.needsUpdate = true;
  });

  if (!active) return null;

  return (
    <points ref={pointsRef} position={position}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={PARTICLE_COUNT}
        />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={0.08}
        transparent
        opacity={0.8}
        sizeAttenuation
      />
    </points>
  );
}

import type { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Stars } from '@react-three/drei';

interface BattlefieldSceneProps {
  children?: ReactNode;
}

export function BattlefieldScene({ children }: BattlefieldSceneProps) {
  return (
    <Canvas
      camera={{ position: [15, 20, 15], fov: 50 }}
      shadows
      style={{ background: '#0a0a1a' }}
    >
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[10, 20, 10]}
        intensity={0.8}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {/* Ground plane */}
      <Ground />

      {/* Grid helper */}
      <Grid
        args={[30, 30]}
        position={[0, 0.01, 0]}
        cellColor="#1a3a2a"
        sectionColor="#00c85333"
        fadeDistance={50}
      />

      {/* Starfield background */}
      <Stars radius={100} depth={50} count={1000} factor={2} />

      {/* Scene children (agents, particles, etc.) */}
      {children}

      {/* Camera controls - RTS style */}
      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        maxPolarAngle={Math.PI / 2.5}
        minDistance={10}
        maxDistance={50}
      />
    </Canvas>
  );
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[30, 30]} />
      <meshStandardMaterial color="#0d1117" />
    </mesh>
  );
}

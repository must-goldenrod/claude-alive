import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';

export type AgentVisualState = 'idle' | 'active' | 'waiting' | 'error';

interface AgentModelProps {
  position: [number, number, number];
  color: string;
  state: AgentVisualState;
  selected?: boolean;
  onClick?: () => void;
}

export function AgentModel({ position, color, state, selected, onClick }: AgentModelProps) {
  const groupRef = useRef<Group>(null);
  const timeRef = useRef(0);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    timeRef.current += delta;
    const t = timeRef.current;

    switch (state) {
      case 'idle': {
        // Gentle vertical bob
        groupRef.current.position.y = position[1] + Math.sin(t * Math.PI) * 0.05;
        groupRef.current.rotation.y = 0;
        groupRef.current.scale.setScalar(1);
        break;
      }
      case 'active': {
        // Faster bob + slight rotation
        groupRef.current.position.y = position[1] + Math.sin(t * Math.PI * 2) * 0.08;
        groupRef.current.rotation.y = Math.sin(t * 0.5) * 0.1;
        groupRef.current.scale.setScalar(1);
        break;
      }
      case 'waiting': {
        // Slow scale pulse
        const pulse = 1 + Math.sin(t * Math.PI) * 0.025;
        groupRef.current.position.y = position[1];
        groupRef.current.rotation.y = 0;
        groupRef.current.scale.setScalar(pulse);
        break;
      }
      case 'error': {
        // Horizontal shake
        groupRef.current.position.y = position[1];
        groupRef.current.position.x = position[0] + Math.sin(t * 30) * 0.03;
        groupRef.current.rotation.y = 0;
        groupRef.current.scale.setScalar(1);
        break;
      }
    }
  });

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {/* Base platform (hexagonal) */}
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.6, 0.1, 6]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {/* Body */}
      <mesh position={[0, 0.7, 0]} castShadow>
        <boxGeometry args={[0.6, 0.8, 0.4]} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.7} />
      </mesh>

      {/* Head/visor */}
      <mesh position={[0, 1.3, 0]} castShadow>
        <boxGeometry args={[0.5, 0.3, 0.35]} />
        <meshStandardMaterial color="#1a1a2a" metalness={0.5} roughness={0.3} />
      </mesh>

      {/* Eye/visor glow */}
      <mesh position={[0, 1.3, 0.18]}>
        <planeGeometry args={[0.3, 0.1]} />
        <meshBasicMaterial color={getStateColor(state)} />
      </mesh>

      {/* Selection ring */}
      {selected && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.7, 0.8, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  );
}

function getStateColor(state: AgentVisualState): string {
  switch (state) {
    case 'active': return '#00ff41';
    case 'waiting': return '#ffab00';
    case 'error': return '#ff1744';
    default: return '#448aff';
  }
}

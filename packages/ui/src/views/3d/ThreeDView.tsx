import { useMemo } from 'react';
import { BattlefieldScene } from './components/BattlefieldScene.tsx';
import { AgentModel } from './components/AgentModel.tsx';
import { ToolParticles } from './components/ToolParticles.tsx';
import { HUD } from './components/HUD.tsx';
import { useBattlefieldState } from './hooks/useBattlefieldState.ts';

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function ThreeDView() {
  const wsUrl = useMemo(getWsUrl, []);
  const { agents, connected, selectedAgent, selectAgent } = useBattlefieldState(wsUrl);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <BattlefieldScene>
        {agents.map(agent => (
          <group key={agent.sessionId}>
            <AgentModel
              position={agent.position}
              color={agent.color}
              state={agent.state}
              selected={agent.selected}
              onClick={() => selectAgent(agent.sessionId)}
            />
            <ToolParticles
              position={[agent.position[0], agent.position[1] + 0.5, agent.position[2]]}
              color={agent.color}
              active={agent.state === 'active'}
            />
          </group>
        ))}
      </BattlefieldScene>
      <HUD connected={connected} agents={agents} selectedAgent={selectedAgent} />
    </div>
  );
}

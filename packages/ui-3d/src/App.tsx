import { useMemo } from 'react';
import { BattlefieldScene } from './components/BattlefieldScene';
import { AgentModel } from './components/AgentModel';
import { ToolParticles } from './components/ToolParticles';
import { HUD } from './components/HUD';
import { useBattlefieldState } from './hooks/useBattlefieldState';

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export default function App() {
  const wsUrl = useMemo(getWsUrl, []);
  const { agents, connected, selectedAgent, selectAgent } = useBattlefieldState(wsUrl);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
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

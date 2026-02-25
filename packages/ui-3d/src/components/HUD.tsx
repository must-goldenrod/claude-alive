import type { BattleAgent } from '../hooks/useBattlefieldState';

interface HUDProps {
  connected: boolean;
  agents: BattleAgent[];
  selectedAgent: BattleAgent | null;
}

export function HUD({ connected, agents, selectedAgent }: HUDProps) {
  return (
    <>
      {/* Connection status - top right */}
      <div style={{
        position: 'absolute',
        top: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'rgba(10, 10, 26, 0.85)',
        borderRadius: 8,
        border: '1px solid var(--border-color)',
        fontSize: 13,
      }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: connected ? 'var(--accent-green)' : 'var(--accent-red)',
          boxShadow: connected ? '0 0 6px var(--accent-green)' : '0 0 6px var(--accent-red)',
        }} />
        <span style={{ color: 'var(--text-secondary)' }}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      {/* Agent count - top left */}
      <div style={{
        position: 'absolute',
        top: 16,
        left: 16,
        padding: '8px 14px',
        background: 'rgba(10, 10, 26, 0.85)',
        borderRadius: 8,
        border: '1px solid var(--border-color)',
        fontSize: 13,
        color: 'var(--text-secondary)',
      }}>
        Agents: <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{agents.length}</span>
      </div>

      {/* Selected agent info - bottom panel */}
      {selectedAgent && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '12px 20px',
          background: 'rgba(10, 10, 26, 0.9)',
          borderRadius: 10,
          border: '1px solid var(--border-color)',
          fontSize: 13,
          minWidth: 280,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              Agent {selectedAgent.sessionId.slice(0, 8)}
            </span>
            <span style={{
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              background: getStateBgColor(selectedAgent.state),
              color: getStateTextColor(selectedAgent.state),
            }}>
              {selectedAgent.state}
            </span>
          </div>
          {selectedAgent.toolAnimation && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              Tool: <span style={{ color: 'var(--accent-purple)' }}>{selectedAgent.toolAnimation}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function getStateBgColor(state: string): string {
  switch (state) {
    case 'active': return 'rgba(0, 200, 83, 0.15)';
    case 'waiting': return 'rgba(255, 171, 0, 0.15)';
    case 'error': return 'rgba(255, 23, 68, 0.15)';
    default: return 'rgba(68, 138, 255, 0.15)';
  }
}

function getStateTextColor(state: string): string {
  switch (state) {
    case 'active': return '#00c853';
    case 'waiting': return '#ffab00';
    case 'error': return '#ff1744';
    default: return '#448aff';
  }
}

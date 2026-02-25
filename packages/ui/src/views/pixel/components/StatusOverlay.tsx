interface StatusOverlayProps {
  connected: boolean;
  agentCount: number;
  url: string;
}

export default function StatusOverlay({ connected, agentCount, url }: StatusOverlayProps) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '12px',
        right: '12px',
        padding: '8px 12px',
        background: 'rgba(10, 10, 15, 0.85)',
        border: '1px solid rgba(42, 42, 58, 0.8)',
        borderRadius: '6px',
        color: '#8888a0',
        fontFamily: 'monospace',
        fontSize: '11px',
        lineHeight: '1.5',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: connected ? '#00c853' : '#ff1744',
          }}
        />
        <span style={{ color: '#e0e0e8' }}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div style={{ marginTop: '2px' }}>
        Agents: {agentCount}
      </div>
      <div
        style={{
          marginTop: '2px',
          fontSize: '9px',
          opacity: 0.6,
          maxWidth: '180px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {url}
      </div>
    </div>
  );
}

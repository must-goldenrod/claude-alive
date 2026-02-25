interface HeaderProps {
  connected: boolean;
  agentCount: number;
}

export function Header({ connected, agentCount }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          claude-alive
        </h1>
        <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
          dashboard
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {agentCount} agent{agentCount !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: connected ? 'var(--accent-green)' : 'var(--accent-red)',
              boxShadow: connected ? '0 0 6px var(--accent-green)' : '0 0 6px var(--accent-red)',
            }}
          />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {connected ? 'connected' : 'disconnected'}
          </span>
        </div>
      </div>
    </header>
  );
}

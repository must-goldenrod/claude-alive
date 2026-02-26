import { useState, Component } from 'react';
import type { ReactNode } from 'react';
import { StyleSelector } from './components/StyleSelector.tsx';
import { UnifiedView } from './views/unified/UnifiedView.tsx';
import type { ViewMode } from './views/unified/UnifiedView.tsx';

const VALID_MODES: ViewMode[] = ['three-d', 'pixel', 'bishoujo'];

function getInitialMode(): ViewMode {
  const stored = localStorage.getItem('claude-alive-style');
  return VALID_MODES.includes(stored as ViewMode) ? (stored as ViewMode) : 'pixel';
}

class SilentErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? null : this.props.children; }
}

export default function App() {
  const [mode, setMode] = useState<ViewMode>(getInitialMode);

  const handleModeChange = (newMode: ViewMode) => {
    setMode(newMode);
    localStorage.setItem('claude-alive-style', newMode);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <StyleSelector current={mode} onChange={handleModeChange} />
      <div style={{ paddingTop: 44, height: '100%', boxSizing: 'border-box' }}>
        <SilentErrorBoundary>
          <UnifiedView viewMode={mode} />
        </SilentErrorBoundary>
      </div>
    </div>
  );
}

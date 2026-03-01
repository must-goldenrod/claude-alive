import { Component, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { HeaderBar } from './components/HeaderBar.tsx';

const PixelOfficePage = lazy(() =>
  import('./views/pixel/PixelOfficePage.tsx').then(m => ({ default: m.PixelOfficePage })),
);

class SilentErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? null : this.props.children; }
}

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <HeaderBar />
      <div style={{ paddingTop: 44, height: '100%', boxSizing: 'border-box' }}>
        <SilentErrorBoundary>
          <Suspense fallback={null}>
            <PixelOfficePage />
          </Suspense>
        </SilentErrorBoundary>
      </div>
    </div>
  );
}

import { Component, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { HeaderBar } from './components/HeaderBar.tsx';

const PixelOfficePage = lazy(() =>
  import('./views/pixel/PixelOfficePage.tsx').then(m => ({ default: m.PixelOfficePage })),
);

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state: { hasError: boolean; error: Error | null } = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[claude-alive] UI error:', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: '#e5534b', fontFamily: 'monospace', textAlign: 'center' }}>
          <p>Something went wrong. Check the browser console for details.</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 12, padding: '6px 16px', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <HeaderBar />
      <div style={{ paddingTop: 56, height: '100%', boxSizing: 'border-box' }}>
        <ErrorBoundary>
          <Suspense fallback={null}>
            <PixelOfficePage />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

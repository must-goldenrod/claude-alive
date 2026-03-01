import { Component, lazy, Suspense, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { HeaderBar } from './components/HeaderBar.tsx';
import { UnifiedView } from './views/unified/UnifiedView.tsx';

const PixelOfficePage = lazy(() =>
  import('./views/pixel/PixelOfficePage.tsx').then(m => ({ default: m.PixelOfficePage })),
);

export type Page = 'dashboard' | 'pixel';

function useHashRoute(): [Page, (p: Page) => void] {
  const read = (): Page => {
    const h = window.location.hash.replace('#', '');
    return h === 'pixel' ? 'pixel' : 'dashboard';
  };

  const [page, setPage] = useState<Page>(read);

  useEffect(() => {
    const onHash = () => setPage(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((p: Page) => {
    window.location.hash = p === 'dashboard' ? '' : p;
    setPage(p);
  }, []);

  return [page, navigate];
}

class SilentErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? null : this.props.children; }
}

export default function App() {
  const [page, navigate] = useHashRoute();

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <HeaderBar page={page} onNavigate={navigate} />
      <div style={{ paddingTop: 44, height: '100%', boxSizing: 'border-box' }}>
        <SilentErrorBoundary>
          {page === 'dashboard' && <UnifiedView />}
          {page === 'pixel' && (
            <Suspense fallback={null}>
              <PixelOfficePage />
            </Suspense>
          )}
        </SilentErrorBoundary>
      </div>
    </div>
  );
}

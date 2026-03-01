import { Component, lazy, Suspense, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { HeaderBar } from './components/HeaderBar.tsx';
import { UnifiedView } from './views/unified/UnifiedView.tsx';

const LazyModelGallery = lazy(() =>
  import('./components/ModelGallery.tsx').then(m => ({ default: m.ModelGallery }))
);

class SilentErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? null : this.props.children; }
}

export default function App() {
  const [galleryOpen, setGalleryOpen] = useState(false);

  const openGallery = useCallback(() => setGalleryOpen(true), []);
  const closeGallery = useCallback(() => setGalleryOpen(false), []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <HeaderBar onGalleryOpen={openGallery} />
      <div style={{ paddingTop: 44, height: '100%', boxSizing: 'border-box' }}>
        <SilentErrorBoundary>
          <UnifiedView />
        </SilentErrorBoundary>
      </div>

      {galleryOpen && (
        <Suspense fallback={null}>
          <LazyModelGallery onClose={closeGallery} />
        </Suspense>
      )}
    </div>
  );
}

import { useState, lazy, Suspense } from 'react';
import { StyleSelector } from './components/StyleSelector.tsx';
import { DashboardView } from './views/dashboard/DashboardView.tsx';
import { PixelView } from './views/pixel/PixelView.tsx';
import { HybridView } from './views/hybrid/HybridView.tsx';

export type UIStyle = 'dashboard' | 'pixel' | 'three-d' | 'hybrid';

// Lazy-load the 3D view to avoid loading Three.js (~1MB) when not needed
const LazyThreeDView = lazy(() =>
  import('./views/3d/ThreeDView.tsx').then(m => ({ default: m.ThreeDView }))
);

function LoadingFallback() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
        fontSize: 14,
      }}
    >
      Loading 3D scene...
    </div>
  );
}

export default function App() {
  const [style, setStyle] = useState<UIStyle>(
    (localStorage.getItem('claude-alive-style') as UIStyle) || 'dashboard'
  );

  const handleStyleChange = (newStyle: UIStyle) => {
    setStyle(newStyle);
    localStorage.setItem('claude-alive-style', newStyle);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <StyleSelector current={style} onChange={handleStyleChange} />
      <div style={{ paddingTop: 40, height: '100%', boxSizing: 'border-box' }}>
        {style === 'dashboard' && <DashboardView />}
        {style === 'pixel' && <PixelView />}
        {style === 'three-d' && (
          <Suspense fallback={<LoadingFallback />}>
            <LazyThreeDView />
          </Suspense>
        )}
        {style === 'hybrid' && <HybridView />}
      </div>
    </div>
  );
}

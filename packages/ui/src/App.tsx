import { useState, lazy, Suspense, Component } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSelector } from './components/StyleSelector.tsx';
import { DashboardView } from './views/dashboard/DashboardView.tsx';
import { PixelView } from './views/pixel/PixelView.tsx';

export type UIStyle = 'dashboard' | 'three-d' | 'pixel';

const VALID_STYLES: UIStyle[] = ['dashboard', 'three-d', 'pixel'];

function getInitialStyle(): UIStyle {
  const stored = localStorage.getItem('claude-alive-style');
  return VALID_STYLES.includes(stored as UIStyle) ? (stored as UIStyle) : 'dashboard';
}

// Lazy-load the 3D view to avoid loading Three.js (~1MB) when not needed
const LazyThreeDView = lazy(() =>
  import('./views/3d/ThreeDView.tsx').then(m => ({ default: m.ThreeDView }))
);

function LoadingFallback() {
  const { t } = useTranslation();
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
      {t('loading')}
    </div>
  );
}

// Silent error boundary — on crash, just render children as-is (or nothing)
class SilentErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? null : this.props.children; }
}

export default function App() {
  const [style, setStyle] = useState<UIStyle>(getInitialStyle);

  const handleStyleChange = (newStyle: UIStyle) => {
    setStyle(newStyle);
    localStorage.setItem('claude-alive-style', newStyle);
  };

  return (
    <div style={{
      width: '100vw',
      height: style === 'dashboard' ? 'auto' : '100vh',
      minHeight: '100vh',
      overflow: style === 'dashboard' ? 'auto' : 'hidden',
    }}>
      <StyleSelector current={style} onChange={handleStyleChange} />
      <div style={{
        paddingTop: 40,
        height: style === 'dashboard' ? 'auto' : '100%',
        minHeight: style === 'dashboard' ? 'calc(100vh - 40px)' : undefined,
        boxSizing: 'border-box',
      }}>
        {style === 'dashboard' && <DashboardView />}
        {style === 'three-d' && (
          <SilentErrorBoundary>
            <Suspense fallback={<LoadingFallback />}>
              <LazyThreeDView />
            </Suspense>
          </SilentErrorBoundary>
        )}
        {style === 'pixel' && (
          <SilentErrorBoundary>
            <PixelView />
          </SilentErrorBoundary>
        )}
      </div>
    </div>
  );
}

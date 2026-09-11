import { getSettings, subscribeSettings, type AppearanceMode } from './settings';

/**
 * Stamps the resolved colour mode on <html data-theme>, which swaps the CSS token
 * set in index.css. 'system' tracks prefers-color-scheme live.
 */

export type ResolvedTheme = 'dark' | 'light';

export function resolveAppearance(mode: AppearanceMode, systemPrefersLight: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersLight ? 'light' : 'dark';
  return mode;
}

export function installAppearance(root: HTMLElement = document.documentElement): () => void {
  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;
  const apply = () => {
    root.dataset.theme = resolveAppearance(getSettings().appearance.mode, media?.matches ?? false);
  };
  apply();
  const unsubscribe = subscribeSettings(apply);
  media?.addEventListener('change', apply);
  return () => {
    unsubscribe();
    media?.removeEventListener('change', apply);
  };
}

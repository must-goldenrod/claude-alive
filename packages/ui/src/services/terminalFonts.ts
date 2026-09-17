/**
 * Terminal fonts.
 *
 * The font presets used to name families the app never loaded, so a preset only
 * changed anything if that font happened to be installed on the viewer's machine —
 * otherwise every one of them silently became the browser's default monospace.
 * The open-licensed families are now bundled (OFL-1.1, via @fontsource) and loaded
 * here; the system presets (SF Mono, Menlo, Monaco) still depend on the OS, which
 * `isFontInstalled` reports so the settings preview can say so.
 */
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/fira-code/400.css';
import '@fontsource/cascadia-code/400.css';
import '@fontsource/source-code-pro/400.css';
import '@fontsource/ibm-plex-mono/400.css';

/** Appended to every preset so a missing face degrades to the platform's own monospace. */
export const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const GENERIC_FAMILIES = new Set(['monospace', 'serif', 'sans-serif', 'ui-monospace', 'system-ui']);

/** First family in a CSS font-family list, unquoted: `"Fira Code", monospace` → `Fira Code`. */
export function primaryFontName(family: string): string {
  const first = family.split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '');
}

/**
 * Wait until the primary face is usable, so xterm measures its cell grid with the
 * real glyphs instead of the fallback's. Never rejects: a font that cannot load
 * simply leaves the fallback in place.
 */
export async function loadTerminalFont(family: string, sizePx: number): Promise<void> {
  const name = primaryFontName(family);
  if (!name || GENERIC_FAMILIES.has(name) || typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.load(`${sizePx}px "${name}"`);
  } catch {
    // Keep the fallback; the terminal stays usable.
  }
}

const PROBE_TEXT = 'mmmmmmmmmmlli0O@#';

/**
 * Whether the browser can render `name` from an installed or loaded face.
 * Compares text width against two different generic fallbacks: if the named face
 * is missing, each measurement collapses to its fallback and differs from neither.
 * Returns `null` when it cannot measure (no canvas, e.g. in tests).
 */
export function isFontInstalled(name: string): boolean | null {
  if (typeof document === 'undefined') return null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;
  const width = (font: string): number => {
    ctx!.font = font;
    return ctx!.measureText(PROBE_TEXT).width;
  };
  const quoted = `"${name}"`;
  return (
    width(`32px ${quoted}, monospace`) !== width('32px monospace') ||
    width(`32px ${quoted}, serif`) !== width('32px serif')
  );
}

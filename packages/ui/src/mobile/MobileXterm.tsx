import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useSettings, resolveTerminalTheme, getFontFamily } from '../services/settings.ts';
import type { TermFeed } from './termFeed.ts';

/**
 * The phone's terminal pane — the same emulator the desktop uses.
 *
 * Claude Code redraws by moving the cursor up and erasing lines, and spaces
 * words with column jumps. A text pane that strips those sequences turns every
 * redraw into appended blank lines and glues words together, so the phone runs
 * a real xterm instead.
 *
 * A pty has exactly one grid, shared by everyone watching it, so who may
 * resize is not a preference — it is ownership:
 *
 * - A terminal this phone started (`owned`) is fitted to the phone: the grid is
 *   recomputed from the pane and reported through `onFit`, and the caller
 *   resizes the pty. Nothing else is watching it, so nothing else is disturbed.
 * - A terminal the desktop started is never resized. Fitting it to a phone
 *   would reflow the desktop's window mid-sentence. The font shrinks until the
 *   columns fit instead, and below a readable floor the pane pans sideways.
 */

/** Smallest font worth rendering; narrower grids scroll horizontally. */
export const MIN_FONT_PX = 7;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/** Monospace cell width per 1px of font size, when it cannot be measured. */
const FALLBACK_CELL_RATIO = 0.6;
/** Narrower than this and even a prompt wraps; wider than the phone is fine. */
export const MIN_FIT_COLS = 20;
export const MIN_FIT_ROWS = 10;

/** Font size (0.1px steps) that fits `cols` cells into `available` px, clamped. */
export function fitFontSize(available: number, cols: number, cellRatio: number, max: number): number {
  if (available <= 0 || cols <= 0 || cellRatio <= 0) return max;
  const size = Math.floor((available / (cols * cellRatio)) * 10) / 10;
  return Math.min(max, Math.max(MIN_FONT_PX, size));
}

/**
 * The grid that fills a pane at a fixed font size — the inverse of
 * `fitFontSize`, used for terminals the phone owns and may resize.
 */
export function fitGrid(width: number, height: number, cellWidth: number, cellHeight: number): { cols: number; rows: number } {
  if (width <= 0 || height <= 0 || cellWidth <= 0 || cellHeight <= 0) {
    return { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
  }
  return {
    cols: Math.max(MIN_FIT_COLS, Math.floor(width / cellWidth)),
    rows: Math.max(MIN_FIT_ROWS, Math.floor(height / cellHeight)),
  };
}

function measureCellRatio(fontFamily: string): number {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return FALLBACK_CELL_RATIO;
    ctx.font = `100px ${fontFamily}`;
    const ratio = ctx.measureText('W').width / 100;
    return ratio > 0 ? ratio : FALLBACK_CELL_RATIO;
  } catch {
    return FALLBACK_CELL_RATIO;
  }
}

export interface MobileXtermProps {
  feed: TermFeed;
  /**
   * This device started the pty, so it may size it. Left false for a terminal
   * the desktop owns — resizing that one reflows the desktop's window.
   */
  owned?: boolean;
  /** The grid this pane wants, reported whenever it changes. `owned` only. */
  onFit?: (cols: number, rows: number) => void;
}

export function MobileXterm({ feed, owned = false, onFit }: MobileXtermProps) {
  const settings = useSettings().terminal;
  const theme = resolveTerminalTheme(settings.themeId, settings.colorOverrides);
  const fontFamily = getFontFamily(settings.fontFamilyId);

  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const gridRef = useRef({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
  // Read by `refit`, which runs from observers and feed events outside render.
  const fontRef = useRef({ family: fontFamily, max: settings.fontSize });
  fontRef.current = { family: fontFamily, max: settings.fontSize };
  const ownRef = useRef({ owned, onFit });
  ownRef.current = { owned, onFit };
  /** Last grid we asked the pty for, so a resize is sent once, not per frame. */
  const requestedRef = useRef<string>('');

  const refit = () => {
    const term = termRef.current;
    const wrap = wrapRef.current;
    if (!term || !wrap) return;
    const { family, max } = fontRef.current;
    const { owned: isOwned, onFit: report } = ownRef.current;

    if (isOwned) {
      // Our pty: keep the font readable and change the grid to match the pane.
      if (term.options.fontSize !== max) term.options.fontSize = max;
      const cellWidth = measureCellRatio(family) * max;
      const cellHeight = max * settings.lineHeight;
      const { cols, rows } = fitGrid(wrap.clientWidth, wrap.clientHeight, cellWidth, cellHeight);
      if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
      const key = `${cols}x${rows}`;
      if (report && requestedRef.current !== key) {
        requestedRef.current = key;
        report(cols, rows);
      }
      return;
    }

    // Someone else's pty: match its grid exactly and shrink the type to fit.
    const { cols, rows } = gridRef.current;
    const size = fitFontSize(wrap.clientWidth, cols, measureCellRatio(family), max);
    if (term.options.fontSize !== size) term.options.fontSize = size;
    if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
  };

  // One emulator per mount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      cols: gridRef.current.cols,
      rows: gridRef.current.rows,
      fontFamily: fontRef.current.family,
      fontSize: fontRef.current.max,
      lineHeight: settings.lineHeight,
      theme,
      scrollback: settings.scrollback,
      allowTransparency: true,
      // Typing goes through the input bar; a focused xterm would raise the
      // soft keyboard on every tap meant as a scroll.
      disableStdin: true,
      cursorBlink: false,
    });
    term.open(host);
    termRef.current = term;
    refit();

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => refit()) : null;
    if (wrapRef.current) observer?.observe(wrapRef.current);
    return () => {
      observer?.disconnect();
      termRef.current = null;
      term.dispose();
    };
    // Mount-only: later settings changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drain the socket's events into the emulator. A new feed is a new session.
  useEffect(() => {
    termRef.current?.reset();
    requestedRef.current = '';
    return feed.listen((event) => {
      const term = termRef.current;
      if (!term) return;
      if (event.kind === 'data') term.write(event.data);
      else if (event.kind === 'reset') term.reset();
      else {
        gridRef.current = { cols: event.cols, rows: event.rows };
        refit();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);

  // Follow the appearance settings the desktop terminal follows.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = theme;
    term.options.fontFamily = fontFamily;
    term.options.lineHeight = settings.lineHeight;
    refit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.themeId, settings.colorOverrides, fontFamily, settings.lineHeight, settings.fontSize, owned]);

  return (
    <div
      ref={wrapRef}
      data-testid="mobile-xterm"
      style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        // A grid wider than the phone pans sideways rather than being cut off;
        // `contain` keeps that pan from becoming the browser's own overscroll,
        // which is what turned a scroll-up into a page refresh.
        overflow: 'auto',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
        background: theme.background,
      }}
    >
      <div ref={hostRef} style={{ display: 'inline-block' }} />
    </div>
  );
}

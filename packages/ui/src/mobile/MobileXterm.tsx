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
 * It renders at the pty's own grid (sent by the server as `terminal:size`)
 * rather than fitting a grid to the phone: resizing a shared pty would reflow
 * the desktop's view too. To keep the layout identical, the font shrinks until
 * the columns fit the width; below a readable floor it stops shrinking and the
 * pane scrolls sideways instead.
 */

/** Smallest font worth rendering; narrower grids scroll horizontally. */
export const MIN_FONT_PX = 7;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/** Monospace cell width per 1px of font size, when it cannot be measured. */
const FALLBACK_CELL_RATIO = 0.6;

/** Font size (0.1px steps) that fits `cols` cells into `available` px, clamped. */
export function fitFontSize(available: number, cols: number, cellRatio: number, max: number): number {
  if (available <= 0 || cols <= 0 || cellRatio <= 0) return max;
  const size = Math.floor((available / (cols * cellRatio)) * 10) / 10;
  return Math.min(max, Math.max(MIN_FONT_PX, size));
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
}

export function MobileXterm({ feed }: MobileXtermProps) {
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

  const refit = () => {
    const term = termRef.current;
    const wrap = wrapRef.current;
    if (!term || !wrap) return;
    const { cols, rows } = gridRef.current;
    const { family, max } = fontRef.current;
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
  }, [settings.themeId, settings.colorOverrides, fontFamily, settings.lineHeight, settings.fontSize]);

  return (
    <div
      ref={wrapRef}
      data-testid="mobile-xterm"
      style={{ width: '100%', overflowX: 'auto', background: theme.background }}
    >
      <div ref={hostRef} style={{ display: 'inline-block' }} />
    </div>
  );
}

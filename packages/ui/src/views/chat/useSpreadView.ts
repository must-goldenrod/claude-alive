/**
 * Spread View orchestration: turns the shared terminal-container wrapper into a
 * resizable tiling grid of live, focusable terminals, wires keyboard shortcuts
 * and hover hints, and persists the layout.
 *
 * The terminals are the same live xterm containers used by single view (never
 * reparented); here they are laid out into grid slots and each is really
 * `fit()`-ed to its cell (unlike the old CSS-scaled preview), so input/output
 * work in place. All DOM work is imperative to coexist with the raw xterm nodes.
 */
import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { TFunction } from 'i18next';
import type { Tab } from './TerminalTabBar.tsx';
import { getSettings } from '../../services/settings.ts';
import {
  fractionsToTemplate,
  resizeAdjacent,
  bumpTrack,
  slotToRC,
  neighborSlot,
  type Direction,
} from './spreadLayout.ts';
import {
  loadSpreadLayout,
  saveSpreadLayout,
  reconcileLayout,
  type SpreadLayout,
} from './spreadLayoutStore.ts';
import {
  SPREAD_SHORTCUTS,
  assertUniqueShortcuts,
  matchShortcut,
  formatShortcut,
  type SpreadShortcut,
} from './spreadShortcuts.ts';

// Surface collisions at import time (throws in dev, logs in prod).
assertUniqueShortcuts();

const GAP = 10;
const PAD = 12;
const GUTTER = 8; // hit area thickness of a resize handle
const LABEL_H = 20;
const DRAG_THRESHOLD = 5;
const RESIZE_STEP_FR = 0.15;

type TermEntry = { term: Terminal; fit: FitAddon };

export interface UseSpreadViewParams {
  spreadActive: boolean;
  /** Re-run trigger: joined tab ids. Changes when the tab *set* changes. */
  spreadTabsKey: string;
  /** Cheap label refresh trigger: joined tab statuses. */
  spreadStatusKey: string;
  wrapperRef: MutableRefObject<HTMLDivElement | null>;
  containersRef: MutableRefObject<Map<string, HTMLDivElement>>;
  termsRef: MutableRefObject<Map<string, TermEntry>>;
  tabsRef: MutableRefObject<Tab[]>;
  activeTabIdRef: MutableRefObject<string>;
  onResizeRef: MutableRefObject<((tabId: string, cols: number, rows: number) => void) | undefined>;
  onSelectSpreadTileRef: MutableRefObject<((tabId: string) => void) | undefined>;
  t: TFunction;
}

/** Status → dot colour, matching single-view tab colours. */
function statusColor(tab: Tab | undefined): string {
  if (!tab || tab.exited) return '#6e7681';
  if (tab.status === 'waiting') return '#ff9f43';
  if (tab.status === 'active') return '#2ea043';
  return '#58a6ff';
}

/** One-line hover hint listing the shortcut families, built from the registry. */
function buildHintText(t: TFunction): string {
  const chord = (id: SpreadShortcut['id']) => {
    const s = SPREAD_SHORTCUTS.find((x) => x.id === id)!;
    return formatShortcut(s);
  };
  return (
    `⌥←→↑↓ ${t('spread.hint.focus')} · ` +
    `⌥⇧ ${t('spread.hint.swap')} · ` +
    `⌥⌃ ${t('spread.hint.resize')} · ` +
    `${chord('maximize')} ${t('spread.hint.maximize')}`
  );
}

export function useSpreadView(params: UseSpreadViewParams): void {
  const {
    spreadActive,
    spreadTabsKey,
    spreadStatusKey,
    wrapperRef,
    containersRef,
    termsRef,
    tabsRef,
    activeTabIdRef,
    onResizeRef,
    onSelectSpreadTileRef,
    t,
  } = params;

  const layoutRef = useRef<SpreadLayout | null>(null);
  const focusedRef = useRef<string>('');
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest t for the imperative label/hint builders without re-running
  // the heavy layout effect on every render.
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const containers = containersRef.current;
    const terms = termsRef.current;

    // ---- Leaving Spread View: restore the single-tab layout. ------------------
    if (!spreadActive) {
      wrapper.style.display = '';
      wrapper.style.gridTemplateColumns = '';
      wrapper.style.gridTemplateRows = '';
      wrapper.style.gap = '';
      wrapper.style.padding = '';
      wrapper.style.overflow = 'hidden';
      overlayRef.current?.remove();
      overlayRef.current = null;
      const settings = getSettings();
      const activeId = activeTabIdRef.current;
      for (const [id, container] of containers) {
        container.style.flex = '1';
        container.style.height = '100%';
        container.style.gridColumn = '';
        container.style.gridRow = '';
        container.style.padding = `${settings.terminal.paddingY}px ${settings.terminal.paddingX}px`;
        container.style.overflow = 'hidden';
        container.style.position = '';
        container.style.border = '';
        container.style.borderRadius = '';
        container.style.boxShadow = '';
        container.style.cursor = '';
        container.style.background = '';
        container.style.display = id === activeId ? 'block' : 'none';
        container.style.opacity = '';
        container.onclick = null;
        container.ondblclick = null;
        container.onmouseenter = null;
        container.onmouseleave = null;
        delete container.dataset.spreadTile;
        container.querySelector<HTMLElement>(':scope > .spread-label')?.remove();
      }
      const entry = terms.get(activeId);
      if (entry) {
        requestAnimationFrame(() => {
          entry.fit.fit();
          onResizeRef.current?.(activeId, entry.term.cols, entry.term.rows);
          entry.term.focus();
        });
      }
      return;
    }

    // ---- Entering / reconfiguring Spread View. --------------------------------
    const tabIds = tabsRef.current.map((tb) => tb.id).filter((id) => containers.has(id));
    if (tabIds.length === 0) return;

    const layout = reconcileLayout(loadSpreadLayout(), tabIds);
    layoutRef.current = layout;
    saveSpreadLayout(layout);

    const tabById = (id: string): Tab | undefined => tabsRef.current.find((tb) => tb.id === id);
    const hintText = buildHintText(tRef.current);

    /** Cell content pixel size along an axis (excludes padding + gaps). */
    const contentW = () => wrapper.clientWidth - 2 * PAD - GAP * (layout.cols - 1);
    const contentH = () => wrapper.clientHeight - 2 * PAD - GAP * (layout.rows - 1);

    const styleTile = (container: HTMLDivElement, focused: boolean): void => {
      container.style.position = 'relative';
      container.style.overflow = 'hidden';
      container.style.borderRadius = '8px';
      container.style.background = 'rgba(0,0,0,0.25)';
      container.style.cursor = 'pointer';
      container.style.border = focused
        ? '1px solid var(--accent-blue)'
        : '1px solid var(--border-color)';
      container.style.boxShadow = focused ? '0 0 0 1px var(--accent-blue)' : 'none';
    };

    const setFocus = (tabId: string): void => {
      focusedRef.current = tabId;
      for (const [id, container] of containers) styleTile(container, id === tabId);
      terms.get(tabId)?.term.focus();
    };

    const fitTile = (id: string): void => {
      const container = containers.get(id);
      const entry = terms.get(id);
      if (!container || !entry) return;
      entry.fit.fit();
      onResizeRef.current?.(id, entry.term.cols, entry.term.rows);
    };
    const fitAll = (): void => {
      for (const id of layout.order) fitTile(id);
    };

    // -- Per-tile label bar (status dot + name + hint + maximize button). --------
    const buildLabel = (container: HTMLDivElement, id: string): void => {
      const tab = tabById(id);
      let label = container.querySelector<HTMLDivElement>(':scope > .spread-label');
      if (!label) {
        label = document.createElement('div');
        label.className = 'spread-label';
        container.insertBefore(label, container.firstChild);
      }
      label.style.cssText =
        `position:absolute;top:0;left:0;right:0;height:${LABEL_H}px;display:flex;align-items:center;` +
        `gap:6px;padding:0 8px;font-family:var(--font-mono);font-size:10px;font-weight:600;` +
        `color:var(--text-secondary);background:rgba(0,0,0,0.55);white-space:nowrap;overflow:hidden;` +
        `z-index:2;cursor:grab;`;
      label.textContent = '';

      const dot = document.createElement('span');
      dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${statusColor(tab)};flex:none;`;
      const name = document.createElement('span');
      name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;flex:none;max-width:40%;';
      const icon = tab?.exited ? (tab.exitCode === 0 ? '✓ ' : '✗ ') : '';
      name.textContent = icon + (tab?.label ?? '');

      const hint = document.createElement('span');
      hint.className = 'spread-hint';
      hint.style.cssText =
        'margin-left:auto;overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .15s;' +
        'font-size:9px;color:var(--text-tertiary,#8b949e);';
      hint.textContent = hintText;

      const maxBtn = document.createElement('button');
      maxBtn.className = 'spread-max';
      maxBtn.style.cssText =
        'flex:none;background:none;border:none;color:var(--text-secondary);cursor:pointer;' +
        'font-size:12px;line-height:1;padding:2px 4px;';
      maxBtn.textContent = '⤢';
      const maxSc = SPREAD_SHORTCUTS.find((s) => s.id === 'maximize')!;
      maxBtn.title = `${tRef.current('spread.shortcut.maximize')} (${formatShortcut(maxSc)})`;
      maxBtn.onclick = (e) => {
        e.stopPropagation();
        onSelectSpreadTileRef.current?.(id);
      };

      label.append(dot, name, hint, maxBtn);
      // Reveal the hint when hovering the tile.
      container.onmouseenter = () => (hint.style.opacity = '1');
      container.onmouseleave = () => (hint.style.opacity = '0');

      // Drag the label to swap tile positions.
      label.onpointerdown = (e) => {
        if (e.target === maxBtn) return;
        startTileDrag(id, e);
      };
    };

    // -- Tile drag → swap slot positions. ---------------------------------------
    const startTileDrag = (sourceId: string, down: PointerEvent): void => {
      const startX = down.clientX;
      const startY = down.clientY;
      let dragging = false;
      const sourceEl = containers.get(sourceId);

      const move = (e: PointerEvent) => {
        if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_THRESHOLD) {
          dragging = true;
          if (sourceEl) sourceEl.style.opacity = '0.5';
        }
      };
      const up = (e: PointerEvent) => {
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', up, true);
        if (sourceEl) sourceEl.style.opacity = '';
        if (!dragging) return;
        const overEl = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>('[data-spread-tile]');
        const targetId = overEl?.dataset.spreadTile;
        if (!targetId || targetId === sourceId) return;
        const order = layoutRef.current!.order.slice();
        const a = order.indexOf(sourceId);
        const b = order.indexOf(targetId);
        if (a < 0 || b < 0) return;
        [order[a], order[b]] = [order[b]!, order[a]!];
        layoutRef.current!.order = order;
        placeTiles();
        requestAnimationFrame(fitAll);
        positionGutters();
        saveSpreadLayout(layoutRef.current!);
        setFocus(sourceId);
      };
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
    };

    // -- Place every container into its grid slot. ------------------------------
    const placeTiles = (): void => {
      const l = layoutRef.current!;
      wrapper.style.gridTemplateColumns = fractionsToTemplate(l.colFractions);
      wrapper.style.gridTemplateRows = fractionsToTemplate(l.rowFractions);
      l.order.forEach((id, slot) => {
        const container = containers.get(id);
        if (!container) return;
        const { r, c } = slotToRC(slot, l.cols);
        container.dataset.spreadTile = id;
        container.style.display = 'block';
        container.style.flex = '';
        container.style.height = '';
        container.style.padding = `${LABEL_H}px 4px 4px 4px`;
        container.style.gridColumn = `${c + 1}`;
        container.style.gridRow = `${r + 1}`;
        styleTile(container, id === focusedRef.current);
        buildLabel(container, id);
        container.onclick = () => setFocus(id);
        container.ondblclick = () => onSelectSpreadTileRef.current?.(id);
      });
    };

    // -- Resize gutters (absolute handles layered over the grid). ----------------
    const buildGutters = (): void => {
      overlayRef.current?.remove();
      const overlay = document.createElement('div');
      overlay.className = 'spread-gutters';
      overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;';
      wrapper.appendChild(overlay);
      overlayRef.current = overlay;

      for (let i = 0; i < layoutRef.current!.cols - 1; i++) addGutter('col', i, overlay);
      for (let i = 0; i < layoutRef.current!.rows - 1; i++) addGutter('row', i, overlay);
      positionGutters();
    };

    const addGutter = (axis: 'col' | 'row', index: number, overlay: HTMLDivElement): void => {
      const g = document.createElement('div');
      g.className = 'spread-gutter';
      g.dataset.axis = axis;
      g.dataset.index = String(index);
      g.style.cssText =
        `position:absolute;pointer-events:auto;z-index:4;` +
        (axis === 'col'
          ? `width:${GUTTER}px;cursor:col-resize;`
          : `height:${GUTTER}px;cursor:row-resize;`);
      g.onpointerdown = (e) => startGutterDrag(axis, index, e);
      overlay.appendChild(g);
    };

    const positionGutters = (): void => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const l = layoutRef.current!;
      const cw = contentW();
      const ch = contentH();
      const sumCol = l.colFractions.reduce((s, f) => s + f, 0);
      const sumRow = l.rowFractions.reduce((s, f) => s + f, 0);
      for (const g of Array.from(overlay.children) as HTMLDivElement[]) {
        const i = Number(g.dataset.index);
        if (g.dataset.axis === 'col') {
          let x = PAD;
          for (let k = 0; k <= i; k++) x += (l.colFractions[k]! / sumCol) * cw + (k < i ? GAP : 0);
          g.style.left = `${x + GAP / 2 - GUTTER / 2}px`;
          g.style.top = `${PAD}px`;
          g.style.height = `${wrapper.clientHeight - 2 * PAD}px`;
        } else {
          let y = PAD;
          for (let k = 0; k <= i; k++) y += (l.rowFractions[k]! / sumRow) * ch + (k < i ? GAP : 0);
          g.style.top = `${y + GAP / 2 - GUTTER / 2}px`;
          g.style.left = `${PAD}px`;
          g.style.width = `${wrapper.clientWidth - 2 * PAD}px`;
        }
      }
    };

    const startGutterDrag = (axis: 'col' | 'row', index: number, down: PointerEvent): void => {
      down.preventDefault();
      const startPos = axis === 'col' ? down.clientX : down.clientY;
      const base = axis === 'col' ? layoutRef.current!.colFractions.slice() : layoutRef.current!.rowFractions.slice();
      const total = axis === 'col' ? contentW() : contentH();

      const move = (e: PointerEvent) => {
        const delta = (axis === 'col' ? e.clientX : e.clientY) - startPos;
        const next = resizeAdjacent(base, index, delta, total);
        if (axis === 'col') {
          layoutRef.current!.colFractions = next;
          wrapper.style.gridTemplateColumns = fractionsToTemplate(next);
        } else {
          layoutRef.current!.rowFractions = next;
          wrapper.style.gridTemplateRows = fractionsToTemplate(next);
        }
        positionGutters();
      };
      const up = () => {
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', up, true);
        requestAnimationFrame(fitAll);
        saveSpreadLayout(layoutRef.current!);
      };
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
    };

    // -- Keyboard shortcut dispatch (capture phase → beats xterm + browser). -----
    const runShortcut = (id: SpreadShortcut['id']): void => {
      const l = layoutRef.current!;
      const focused = focusedRef.current || l.order[0]!;
      const slot = l.order.indexOf(focused);
      if (slot < 0) return;
      const dirOf: Record<string, Direction> = {
        left: 'left',
        right: 'right',
        up: 'up',
        down: 'down',
      };

      if (id.startsWith('focus-')) {
        const n = neighborSlot(slot, dirOf[id.slice(6)]!, l.cols, l.rows, l.order.length);
        if (n != null) setFocus(l.order[n]!);
      } else if (id.startsWith('swap-')) {
        const n = neighborSlot(slot, dirOf[id.slice(5)]!, l.cols, l.rows, l.order.length);
        if (n != null) {
          [l.order[slot], l.order[n]] = [l.order[n]!, l.order[slot]!];
          placeTiles();
          requestAnimationFrame(fitAll);
          positionGutters();
          saveSpreadLayout(l);
          setFocus(focused);
        }
      } else if (id === 'grow-width' || id === 'shrink-width') {
        const { c } = slotToRC(slot, l.cols);
        l.colFractions = bumpTrack(l.colFractions, c, id === 'grow-width' ? RESIZE_STEP_FR : -RESIZE_STEP_FR);
        wrapper.style.gridTemplateColumns = fractionsToTemplate(l.colFractions);
        positionGutters();
        requestAnimationFrame(fitAll);
        saveSpreadLayout(l);
      } else if (id === 'grow-height' || id === 'shrink-height') {
        const { r } = slotToRC(slot, l.cols);
        l.rowFractions = bumpTrack(l.rowFractions, r, id === 'grow-height' ? RESIZE_STEP_FR : -RESIZE_STEP_FR);
        wrapper.style.gridTemplateRows = fractionsToTemplate(l.rowFractions);
        positionGutters();
        requestAnimationFrame(fitAll);
        saveSpreadLayout(l);
      } else if (id === 'maximize') {
        onSelectSpreadTileRef.current?.(focused);
      } else if (id === 'reset-layout') {
        const reset = reconcileLayout(null, tabsRef.current.map((tb) => tb.id).filter((x) => containers.has(x)));
        layoutRef.current = reset;
        placeTiles();
        buildGutters();
        requestAnimationFrame(fitAll);
        saveSpreadLayout(reset);
        setFocus(reset.order[0]!);
      }
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      const sc = matchShortcut(e);
      if (!sc) return;
      e.preventDefault();
      e.stopPropagation();
      runShortcut(sc.id);
    };

    // ---- Assemble the grid. ---------------------------------------------------
    wrapper.style.display = 'grid';
    wrapper.style.gap = `${GAP}px`;
    wrapper.style.padding = `${PAD}px`;
    wrapper.style.overflow = 'hidden';
    wrapper.style.position = 'relative';

    placeTiles();
    buildGutters();
    // Initial focus: the previously-active tab if present, else the first tile.
    const initialFocus = layout.order.includes(activeTabIdRef.current)
      ? activeTabIdRef.current
      : layout.order[0]!;
    setFocus(initialFocus);

    let raf = requestAnimationFrame(fitAll);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        positionGutters();
        fitAll();
      });
    });
    ro.observe(wrapper);
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('keydown', onKeyDown, true);
      overlayRef.current?.remove();
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadActive, spreadTabsKey]);

  // Cheap label/status refresh without rebuilding the grid.
  useEffect(() => {
    if (!spreadActive) return;
    const containers = containersRef.current;
    for (const tab of tabsRef.current) {
      const label = containers.get(tab.id)?.querySelector<HTMLElement>(':scope > .spread-label');
      const dot = label?.querySelector<HTMLElement>('span');
      if (dot) dot.style.background = statusColor(tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadActive, spreadStatusKey]);
}

import type { ViewMode } from '../App.tsx';

/**
 * Navigation grouping for the header. Single source of truth for "which view
 * belongs to which tier". HeaderBar only renders this — it never re-decides
 * grouping. See docs/superpowers/specs/2026-07-22-ticket-centric-ia-design.md.
 *
 * - primary: the ticket hub — the default surface you live in.
 * - monitor: live observation surfaces you drop into when a ticket needs a
 *            closer look or direct intervention (animation, list, spread).
 * - tools:   analysis + productivity surfaces used alongside the main flow
 *            (board first — it holds work/cost analytics — then workspace).
 *
 * All three tiers are rendered inline in the header (no dropdown, no visible
 * group caption) so every surface is one click away and self-describing.
 */
export type ViewGroup = 'primary' | 'monitor' | 'tools';

export interface ViewModeMeta {
  mode: ViewMode;
  labelKey: string;
  group: ViewGroup;
}

const LEGACY_BOARD_MODES: ReadonlySet<ViewMode> = new Set([
  'prompt',
  'efficio',
  'archive',
  'ticketMgmt',
  'data',
]);

/** Keep legacy links usable after their standalone content views moved into Board. */
export function normalizeViewMode(mode: ViewMode): ViewMode {
  return LEGACY_BOARD_MODES.has(mode) ? 'board' : mode;
}

/**
 * Ordered nav metadata. `jarvis` is intentionally omitted — it is not surfaced
 * in the header (matches prior behaviour).
 */
export const VIEW_MODE_META: readonly ViewModeMeta[] = [
  { mode: 'tickets', labelKey: 'viewMode.tickets', group: 'primary' },
  { mode: 'animation', labelKey: 'viewMode.animation', group: 'monitor' },
  { mode: 'list', labelKey: 'viewMode.list', group: 'monitor' },
  { mode: 'spread', labelKey: 'viewMode.spread', group: 'monitor' },
  { mode: 'board', labelKey: 'viewMode.board', group: 'tools' },
  { mode: 'workspace', labelKey: 'viewMode.workspace', group: 'tools' },
  // `backends` (backend connection) moved into the Settings modal (backend tab),
  // so it is no longer a standalone tools view.
];

/** Views in a given group, preserving declaration order. */
export function viewsInGroup(group: ViewGroup): ViewModeMeta[] {
  return VIEW_MODE_META.filter((m) => m.group === group);
}

/** The group a view belongs to, or undefined if it is not surfaced in the header. */
export function groupOf(mode: ViewMode): ViewGroup | undefined {
  return VIEW_MODE_META.find((m) => m.mode === mode)?.group;
}

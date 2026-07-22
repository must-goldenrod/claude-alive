import type { ViewMode } from '../App.tsx';

/**
 * Navigation grouping for the header. Single source of truth for "which view
 * belongs to which tier". HeaderBar only renders this — it never re-decides
 * grouping. See docs/superpowers/specs/2026-07-22-ticket-centric-ia-design.md.
 *
 * - primary:   the ticket hub — the default surface you live in.
 * - intervene: observation / hands-on views you drop into when a ticket needs
 *              a closer look or direct intervention (animation, list, spread).
 * - tools:     productivity features managed separately from the main flow
 *              (workspace, prompt, efficio, session management, ticket management).
 */
export type ViewGroup = 'primary' | 'intervene' | 'tools';

export interface ViewModeMeta {
  mode: ViewMode;
  labelKey: string;
  group: ViewGroup;
}

/**
 * Ordered nav metadata. `jarvis` is intentionally omitted — it is not surfaced
 * in the header (matches prior behaviour).
 */
export const VIEW_MODE_META: readonly ViewModeMeta[] = [
  { mode: 'tickets', labelKey: 'viewMode.tickets', group: 'primary' },
  { mode: 'animation', labelKey: 'viewMode.animation', group: 'intervene' },
  { mode: 'list', labelKey: 'viewMode.list', group: 'intervene' },
  { mode: 'spread', labelKey: 'viewMode.spread', group: 'intervene' },
  { mode: 'workspace', labelKey: 'viewMode.workspace', group: 'tools' },
  { mode: 'prompt', labelKey: 'viewMode.prompt', group: 'tools' },
  { mode: 'efficio', labelKey: 'viewMode.efficio', group: 'tools' },
  // `archive` is the session-management surface (kept id for low churn); its label
  // now reads "Session Management". `ticketMgmt` is the ticket-centric companion.
  { mode: 'archive', labelKey: 'viewMode.archive', group: 'tools' },
  { mode: 'ticketMgmt', labelKey: 'viewMode.ticketMgmt', group: 'tools' },
  { mode: 'backends', labelKey: 'viewMode.backends', group: 'tools' },
];

/** Views in a given group, preserving declaration order. */
export function viewsInGroup(group: ViewGroup): ViewModeMeta[] {
  return VIEW_MODE_META.filter((m) => m.group === group);
}

/** The group a view belongs to, or undefined if it is not surfaced in the header. */
export function groupOf(mode: ViewMode): ViewGroup | undefined {
  return VIEW_MODE_META.find((m) => m.mode === mode)?.group;
}

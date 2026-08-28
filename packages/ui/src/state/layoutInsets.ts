/**
 * Left-edge insets for everything that positions itself against the viewport.
 *
 * The shell lays the repo sidebar out with flexbox, but overlays and docks use
 * `position: fixed` — they sit outside that flow and would otherwise cover the
 * sidebar. They read their left edge from here instead of hardcoding a width,
 * so the sidebar's size lives in exactly one place.
 */

/** Width of the shared repo sidebar. Must match RepoSidebar's own width. */
export const REPO_SIDEBAR_WIDTH = 280;

/** Width of the per-view agent sidebar (list and animation views). */
export const PROJECT_SIDEBAR_WIDTH = 300;

export interface LayoutInsets {
  /** Past the repo sidebar. For the to-do dock and the body-wide terminal modes. */
  repo: number;
  /** Past every sidebar the list layout shows. For the terminal's list mode. */
  list: number;
}

/**
 * Both sidebars answer to the header's single left-panel toggle, so one flag
 * decides every inset. Collapsed sidebars render at width 0, not a rail, which
 * is why the collapsed case is a flat zero.
 */
export function layoutInsets(leftPanelOpen: boolean): LayoutInsets {
  const repo = leftPanelOpen ? REPO_SIDEBAR_WIDTH : 0;
  return {
    repo,
    list: repo + (leftPanelOpen ? PROJECT_SIDEBAR_WIDTH : 0),
  };
}

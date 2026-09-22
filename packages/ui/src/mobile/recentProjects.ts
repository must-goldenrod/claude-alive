/**
 * Directories this device has actually worked in, most recent first.
 *
 * The allowlist answers "where may I run", which is a set of twenty-odd
 * checkouts in no particular order. It never answers "where was I yesterday",
 * and on a phone that is the question — the same two or three folders come up
 * again and again, and hunting for them in an alphabetical list every time is
 * the whole friction. Kept per device in localStorage: it is a convenience,
 * not state anything else reads.
 */
import type { MobileProject } from './types.ts';

const KEY = 'claude-alive.mobile.recentCwd';
/** Enough to cover a week of work without pushing the folder list off screen. */
export const MAX_RECENT = 8;

export interface RecentProject extends MobileProject {
  /** When this device last chose the directory. */
  usedAt: number;
}

function isRecent(value: unknown): value is RecentProject {
  const r = value as Partial<RecentProject> | null;
  return typeof r?.path === 'string' && r.path.length > 0 && typeof r.name === 'string';
}

export function loadRecentProjects(): RecentProject[] {
  try {
    const raw = window.localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecent)
      .map((r) => ({ path: r.path, name: r.name, usedAt: typeof r.usedAt === 'number' ? r.usedAt : 0 }))
      .sort((a, b) => b.usedAt - a.usedAt)
      .slice(0, MAX_RECENT);
  } catch {
    // Private mode, blocked storage, or a corrupted value: an empty history is
    // a working picker, a thrown error is not.
    return [];
  }
}

/** Record a choice. Re-choosing an existing path moves it to the top. */
export function rememberProject(project: MobileProject, now: number = Date.now()): RecentProject[] {
  if (!project.path) return loadRecentProjects();
  const next = [
    { path: project.path, name: project.name, usedAt: now },
    ...loadRecentProjects().filter((r) => r.path !== project.path),
  ].slice(0, MAX_RECENT);
  try {
    window.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage is a convenience here; the choice still works without it */
  }
  return next;
}

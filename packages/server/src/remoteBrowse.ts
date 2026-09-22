/**
 * Directory listing for a remote device, fenced by the ticket-root allowlist.
 *
 * `/api/fs/browse` reads any directory and stays closed to a device for that
 * reason. But a fixed list of "the roots and their immediate git children" is
 * ~20 entries, and the checkout someone actually wants on their phone is often
 * two or three levels down. So this is the middle ground: walk as deep as you
 * like, but only inside `CLAUDE_ALIVE_TICKET_ROOTS` — the same fence a remote
 * ticket's cwd already has to clear, so browsing grants no reach the caller
 * did not already have.
 *
 * The allowlist is checked twice on purpose: once on the requested path, and
 * again on its `realpath`. A symlink inside a root pointing at `/etc` passes
 * the first check and fails the second.
 */
import { existsSync } from 'node:fs';
import { readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isCwdAllowed } from './ticketRunner.js';

/** Entries returned for one directory. A phone cannot use more, and a huge
 *  directory should not become a huge JSON body. */
export const MAX_BROWSE_ENTRIES = 500;

export interface BrowseEntry {
  name: string;
  path: string;
  /** A checkout — the thing worth selecting, marked so the UI can say so. */
  isGit: boolean;
}

export interface BrowseResult {
  /** The directory listed, or null when the answer is the root list itself. */
  path: string | null;
  /** One level up, or null at a root boundary (there is nothing above it). */
  parent: string | null;
  roots: string[];
  entries: BrowseEntry[];
  /** More entries existed than were returned. */
  truncated: boolean;
}

export class BrowseError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 503, message: string) {
    super(message);
    this.name = 'BrowseError';
  }
}

/** The roots themselves, as the first screen of the browser. */
function rootListing(roots: readonly string[]): BrowseResult {
  const entries = roots.map((root) => ({
    name: root,
    path: resolve(root),
    isGit: existsSync(join(root, '.git')),
  }));
  return { path: null, parent: null, roots: [...roots], entries, truncated: false };
}

export async function browseRemoteDirs(
  raw: string | null | undefined,
  roots: readonly string[],
): Promise<BrowseResult> {
  if (roots.length === 0) {
    throw new BrowseError(503, 'No ticket roots are configured, so there is nothing a device may browse');
  }
  const requested = raw?.trim();
  if (!requested) return rootListing(roots);

  if (!isAbsolute(requested)) throw new BrowseError(400, 'path must be absolute');
  const target = resolve(requested);
  if (!isCwdAllowed(target, roots)) throw new BrowseError(403, 'path is outside the ticket-root allowlist');

  let real: string;
  try {
    real = await realpath(target);
  } catch {
    throw new BrowseError(404, 'directory does not exist');
  }
  // A symlink inside a root may point anywhere; the resolved path is the one
  // that has to clear the fence.
  if (!isCwdAllowed(real, roots)) throw new BrowseError(403, 'path resolves outside the ticket-root allowlist');

  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await readdir(real, { withFileTypes: true, encoding: 'utf-8' });
  } catch {
    throw new BrowseError(404, 'directory cannot be read');
  }

  const all = dirents
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const path = join(real, entry.name);
      return { name: entry.name, path, isGit: existsSync(join(path, '.git')) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const up = dirname(real);
  return {
    path: real,
    // At a root boundary `dirname` leaves the allowlist, and there is no "up".
    parent: up !== real && isCwdAllowed(up, roots) ? up : null,
    roots: [...roots],
    entries: all.slice(0, MAX_BROWSE_ENTRIES),
    truncated: all.length > MAX_BROWSE_ENTRIES,
  };
}

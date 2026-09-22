/**
 * Client for the server's ticket-root-fenced directory listing.
 *
 * Separate from the components so the fallback is one decision in one place:
 * an older server, or one with browsing unconfigured, answers 404/503, and the
 * pickers then show the flat allowlist they showed before rather than an error.
 */
export interface BrowseEntry {
  name: string;
  path: string;
  isGit: boolean;
}

export interface BrowseResult {
  path: string | null;
  parent: string | null;
  roots: string[];
  entries: BrowseEntry[];
  truncated: boolean;
}

/** Thrown for a refusal the user should see (403 outside the roots, 404 gone). */
export class BrowseUnavailable extends Error {}

export async function fetchBrowse(apiBase: string, path: string | null): Promise<BrowseResult> {
  const url = path
    ? `${apiBase}/api/remote/browse?path=${encodeURIComponent(path)}`
    : `${apiBase}/api/remote/browse`;
  const res = await fetch(url);
  if (res.status === 404 || res.status === 503) throw new BrowseUnavailable('browsing is not available');
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `browse failed (${res.status})`);
  }
  return (await res.json()) as BrowseResult;
}

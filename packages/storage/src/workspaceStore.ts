/**
 * Persisted workspace catalog (spec §F.5, §I.5).
 *
 * The probe can re-derive a workspace's *details* at any time, but not its
 * *identity*: `workspaceId` is a freshly minted ULID on every boot. Storing the
 * mapping keyed by `(locationId, rootPath)` is what keeps one repository as one
 * workspace across restarts — without it, every restart forks the tree.
 *
 * Mutable details (display name, repo metadata) are refreshed on each upsert;
 * the id never changes once assigned.
 */

import type { WorkspaceIdentity } from '@claude-alive/core';
import type { Database } from './db.js';

interface WorkspaceRow {
  workspace_id: string;
  location_id: string;
  root_path: string;
  kind: string;
  display_name: string;
  custom_name: string | null;
  repo_url: string | null;
  repo_host: string | null;
  repo_owner: string | null;
  repo_name: string | null;
}

function rowToIdentity(row: WorkspaceRow): WorkspaceIdentity {
  const identity: WorkspaceIdentity = {
    workspaceId: row.workspace_id,
    locationId: row.location_id,
    rootPath: row.root_path,
    kind: row.kind as WorkspaceIdentity['kind'],
    displayName: row.display_name,
  };
  if (row.custom_name !== null) identity.customName = row.custom_name;
  if (row.repo_name !== null) {
    identity.repo = {
      name: row.repo_name,
      ...(row.repo_url !== null ? { remoteUrlNormalized: row.repo_url } : {}),
      ...(row.repo_host !== null ? { host: row.repo_host } : {}),
      ...(row.repo_owner !== null ? { owner: row.repo_owner } : {}),
    };
  }
  return identity;
}

export class WorkspaceStore {
  constructor(private readonly db: Database) {}

  find(locationId: string, rootPath: string): WorkspaceIdentity | undefined {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE location_id = ? AND root_path = ?')
      .get(locationId, rootPath) as WorkspaceRow | undefined;
    return row ? rowToIdentity(row) : undefined;
  }

  findById(workspaceId: string): WorkspaceIdentity | undefined {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE workspace_id = ?')
      .get(workspaceId) as WorkspaceRow | undefined;
    return row ? rowToIdentity(row) : undefined;
  }

  /**
   * Store the identity, keeping any id already assigned to this
   * `(locationId, rootPath)` and refreshing the mutable details.
   */
  upsert(identity: WorkspaceIdentity): WorkspaceIdentity {
    const existing = this.find(identity.locationId, identity.rootPath);
    const workspaceId = existing?.workspaceId ?? identity.workspaceId;

    this.db
      .prepare(
        `INSERT INTO workspaces
           (workspace_id, location_id, root_path, kind, display_name, custom_name,
            repo_url, repo_host, repo_owner, repo_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (location_id, root_path) DO UPDATE SET
           kind = excluded.kind,
           display_name = excluded.display_name,
           custom_name = excluded.custom_name,
           repo_url = excluded.repo_url,
           repo_host = excluded.repo_host,
           repo_owner = excluded.repo_owner,
           repo_name = excluded.repo_name`,
      )
      .run(
        workspaceId,
        identity.locationId,
        identity.rootPath,
        identity.kind,
        identity.displayName,
        identity.customName ?? null,
        identity.repo?.remoteUrlNormalized ?? null,
        identity.repo?.host ?? null,
        identity.repo?.owner ?? null,
        identity.repo?.name ?? null,
      );

    return this.find(identity.locationId, identity.rootPath)!;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM workspaces').get() as { c: number };
    return row.c;
  }
}

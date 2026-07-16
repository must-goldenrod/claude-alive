/**
 * Location and workspace identity (spec §F.5, §I.1).
 *
 * Location is the physical/execution place (local device, SSH host, container),
 * independent of provider. Workspace is a canonical root path plus optional git
 * repository identity within a location. A path alone is not a stable key —
 * local and SSH can share the same string path — so `(locationId, rootPath)` is
 * the identity key. Remote-url credentials are stripped before storage.
 */

export type LocationKind = 'local' | 'ssh' | 'container' | 'remote-runtime';

export type LocationStatus =
  | 'online'
  | 'reconnecting'
  | 'auth-required'
  | 'offline';

export interface LocationSummary {
  locationId: string;
  kind: LocationKind;
  displayName: string;
  status: LocationStatus;
}

export interface RepositoryIdentity {
  /** Remote url with any userinfo/credentials removed. */
  remoteUrlNormalized?: string;
  host?: string;
  owner?: string;
  name: string;
}

export interface WorkspaceIdentity {
  workspaceId: string;
  locationId: string;
  rootPath: string;
  kind: 'git' | 'folder';
  displayName: string;
  customName?: string;
  repo?: RepositoryIdentity;
}

/**
 * Where a ticket's agent runs (spec 2026-07-22 §2).
 *
 * A ticket runs either on the server's own machine (`local`) or on a remote host
 * over SSH (`ssh`). The location is chosen at creation and stored on the ticket;
 * absent means local (backward-compatible). This is the seam a future codex /
 * litellm / hermes backend would extend.
 */
export type LocationKind = 'local' | 'ssh';

/** SSH connection target — mirrors the structured fields of an SSH preset. */
export interface SshTarget {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

export interface TicketLocation {
  kind: LocationKind;
  /** Present only when kind === 'ssh'. */
  ssh?: SshTarget;
  /** Human label (e.g. the preset name), for display. */
  label?: string;
}

/** `dev@192.168.100.99` / `192.168.100.99:2222` — a compact target for the UI. */
export function sshTargetDisplay(t: SshTarget): string {
  const at = t.user ? `${t.user}@${t.host}` : t.host;
  return t.port && t.port !== 22 ? `${at}:${t.port}` : at;
}

/** True when the location runs off-machine (currently only ssh). */
export function isRemoteLocation(loc?: TicketLocation | null): boolean {
  return loc?.kind === 'ssh';
}

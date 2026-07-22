/**
 * Alive session id ↔ provider session id mapping (ADR-0011, spec §I.4).
 *
 * Alive keys everything internally by a ULID; providers key by their own session
 * ids. This store is the **only** place those two vocabularies meet. Keeping it
 * single-purpose is what allows the prompt and efficio databases to stay joined
 * on `providerSessionId` without ever learning about Alive's ULIDs.
 *
 * `resolve` is idempotent: the same provider session always maps to the same
 * Alive id, so replaying hooks after a restart does not fork a session.
 */

import type { Database } from './db.js';

export interface ProviderRef {
  provider: string;
  providerSessionId: string;
}

export class SessionRefStore {
  constructor(
    private readonly db: Database,
    private readonly newId: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Existing Alive id for a provider session, or undefined. Mints nothing. */
  findAliveId(provider: string, providerSessionId: string): string | undefined {
    const row = this.db
      .prepare(
        'SELECT alive_session_id AS id FROM session_provider_refs WHERE provider = ? AND provider_session_id = ?',
      )
      .get(provider, providerSessionId) as { id: string } | undefined;
    return row?.id;
  }

  findProviderRef(aliveSessionId: string): ProviderRef | undefined {
    const row = this.db
      .prepare(
        'SELECT provider, provider_session_id AS pid FROM session_provider_refs WHERE alive_session_id = ?',
      )
      .get(aliveSessionId) as { provider: string; pid: string } | undefined;
    return row ? { provider: row.provider, providerSessionId: row.pid } : undefined;
  }

  /** Return the Alive id for a provider session, minting one on first sight. */
  resolve(provider: string, providerSessionId: string): string {
    const existing = this.findAliveId(provider, providerSessionId);
    if (existing) return existing;

    const id = this.newId();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO session_provider_refs
           (alive_session_id, provider, provider_session_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, provider, providerSessionId, this.now());

    // A concurrent writer may have won the race; re-read so callers always get
    // the id that is actually stored rather than the one we tried to mint.
    return this.findAliveId(provider, providerSessionId) ?? id;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM session_provider_refs').get() as { c: number };
    return row.c;
  }
}

/**
 * Billing and availability guard around the Jev client.
 *
 * Jev is open to this account for free right now. That is a temporary state: the
 * key can be revoked, the free tier can end, or the whole thing can move behind
 * a paywall — none of which this server would notice on its own, because the
 * only thing that currently arms the fallback is "a key is present".
 *
 * So the rule this module enforces is: **the moment access stops being free,
 * usage stops.** Not degrades, not retries more slowly — stops, for the life of
 * the process, and says so once in the log. A verdict this seat does not produce
 * costs nothing: the gate falls back to exactly what it did before Jev existed
 * (the ticket ends inconclusive), which is why refusing to call is always the
 * safe direction here.
 *
 * Three signals disarm it:
 *  - HTTP 401/403 — the key no longer works.
 *  - HTTP 402 — payment required. This is the paywall, arriving literally.
 *  - `quota.remaining <= 0` — the account has spent its allowance. The API only
 *    sends a `quota` block on metered plans, so its appearance at zero is the
 *    metered version of the same message.
 *
 * A 429 or a 5xx does NOT disarm: those are "not now", not "not any more", and
 * the client already bounds them with a single retry.
 *
 * On top of that a per-process call budget bounds the damage from a bug on our
 * side — a retry loop that somehow reaches this code cannot spend more than the
 * budget before it shuts itself off.
 */
import { JevError, type JevClient, type JevDecideOptions, type JevQuestion, type JevResult, type JevState } from './client.js';

/**
 * Calls one server process may make before it shuts the seat off.
 *
 * The fallback fires only when the completion gate produces no verdict — 12 of
 * 394 verified tickets, 3.0%. A process that reaches 200 has stopped doing what
 * this seat is for, whatever the reason, and the budget turns that into a stop
 * instead of a bill.
 */
export const JEV_DEFAULT_CALL_BUDGET = 200;

/** `CA_JEV_FALLBACK` values that turn the seat off without touching the key file. */
const OFF_VALUES = new Set(['0', 'off', 'false', 'no']);

/**
 * Whether the fallback may be armed at all.
 *
 * The off switch is separate from the key on purpose: revoking access should not
 * require editing the file that holds the credential, and an operator who wants
 * Jev off during a billing change should not have to keep a copy of the key
 * somewhere else while they do it.
 */
export function jevEnabled(env: NodeJS.ProcessEnv): boolean {
  if (!(env.TYPESAFE_API_KEY ?? '').trim()) return false;
  return !OFF_VALUES.has((env.CA_JEV_FALLBACK ?? '').trim().toLowerCase());
}

export interface GuardedJevClient extends JevClient {
  /** Why the seat shut itself off, or null while it is still armed. */
  readonly disarmedReason: string | null;
}

export interface GuardJevOptions {
  budget?: number;
  log?: (message: string) => void;
}

/** True for a status that means access itself has changed, not that the server is busy. */
function isAccessRevoked(status: number | undefined): boolean {
  return status === 401 || status === 402 || status === 403;
}

export function guardJevClient(inner: JevClient, opts: GuardJevOptions = {}): GuardedJevClient {
  const budget = opts.budget ?? JEV_DEFAULT_CALL_BUDGET;
  const log = opts.log ?? ((message: string) => console.warn(message));
  let disarmedReason: string | null = null;
  let calls = 0;

  function disarm(reason: string): void {
    if (disarmedReason !== null) return;
    disarmedReason = reason;
    // Once, loudly: a seat that silently stopped working is the failure this
    // whole module exists to prevent.
    log(`[verify] Jev fallback DISARMED for this process — ${reason}. No further Jev calls will be made.`);
  }

  return {
    model: inner.model,
    get disarmedReason(): string | null {
      return disarmedReason;
    },
    async decide(
      state: JevState,
      questions: Record<string, JevQuestion>,
      decideOpts?: JevDecideOptions,
    ): Promise<JevResult> {
      if (disarmedReason !== null) {
        throw new JevError(`Jev fallback is disarmed: ${disarmedReason}`);
      }
      if (calls >= budget) {
        disarm(`call budget of ${budget} reached`);
        throw new JevError(`Jev fallback is disarmed: call budget of ${budget} reached`);
      }

      calls += 1;
      let result: JevResult;
      try {
        result = await inner.decide(state, questions, decideOpts);
      } catch (error) {
        if (error instanceof JevError && isAccessRevoked(error.status)) {
          disarm(
            `the API answered HTTP ${error.status} (access revoked, or no longer free for this account)`,
          );
        }
        throw error;
      }

      const remaining = result.quota?.remaining;
      if (remaining !== undefined && remaining <= 0) {
        disarm('the account reports no quota remaining');
      }
      return result;
    },
  };
}

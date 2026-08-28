/**
 * Decides what a failed delegation means: try the next model, or stop.
 *
 * The distinction that matters is model-specific vs. account-wide. A 429 (`5-hour
 * usage limit reached`) or a retired model id is one model's problem and the
 * subtask should move on; a bad API key would fail identically on every model,
 * so walking the chain would just be four more round-trips to the same answer.
 */
import { LitellmHttpError } from './litellmClient.js';
import { parseCooldownMs } from './modelCooldown.js';

export interface DelegateErrorVerdict {
  /** Try the next model in the chain. */
  readonly retryable: boolean;
  /** Present when the failure is durable enough to remember across processes. */
  readonly cooldownMs?: number;
  readonly status?: number;
  readonly message: string;
}

/** A model id the gateway no longer serves — shelve it for a while, not forever. */
const RETIRED_MODEL_MS = 60 * 60_000;
const RETIRED_MODEL_RE = /invalid model|model[_ ]not[_ ]found|does not exist|no deployments|no such model/i;

export function classifyDelegateError(e: unknown): DelegateErrorVerdict {
  if (e instanceof LitellmHttpError) {
    const message = e.message;
    if (e.status === 429) {
      return {
        retryable: true,
        cooldownMs: parseCooldownMs(e.body, e.retryAfter),
        status: e.status,
        message,
      };
    }
    if (e.status === 401 || e.status === 403) {
      // Credentials, not capacity: every model behind this key fails the same way.
      return { retryable: false, status: e.status, message };
    }
    if (e.status === 402) {
      return { retryable: true, cooldownMs: RETIRED_MODEL_MS, status: e.status, message };
    }
    if (e.status === 400 || e.status === 404) {
      // Two shapes land here: a retired id (durable — shelve it) and a request
      // this model can't take, e.g. context-window overflow (transient for a
      // bigger-context peer, so retry but do not shelve).
      const retired = RETIRED_MODEL_RE.test(e.body);
      return {
        retryable: true,
        ...(retired ? { cooldownMs: RETIRED_MODEL_MS } : {}),
        status: e.status,
        message,
      };
    }
    if (e.status >= 500 || e.status === 408 || e.status === 409) {
      return { retryable: true, status: e.status, message };
    }
    return { retryable: false, status: e.status, message };
  }

  // Timeouts and network faults: nothing learnt about the model, just try another.
  const message = e instanceof Error ? e.message : 'delegation failed';
  return { retryable: true, message };
}

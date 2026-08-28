/**
 * Cross-process cooldown memory for delegation models.
 *
 * Each `ca-delegate` call is its own short-lived process, so a rate limit learnt
 * in one call is forgotten by the next unless it is written down. The gateway's
 * 429s are long (`5-hour usage limit reached. Resets in 50min.`), so without
 * this every delegation would burn a round-trip on a model that is known-cold.
 *
 * The file is advisory: a corrupt or missing file simply means "nothing is
 * cooling", and writes are best-effort (never fail a delegation over the log).
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export const COOLDOWN_PATH = join(homedir(), '.claude-alive', 'delegate-cooldowns.json');

/** Applied when a 429 carries no parseable reset hint. */
export const DEFAULT_COOLDOWN_MS = 15 * 60_000;
const MIN_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 6 * 60 * 60_000;

/** model id → epoch ms at which it may be tried again. */
export type CooldownMap = Readonly<Record<string, number>>;

export interface CooldownStore {
  /** Entries still in the future, keyed by model id. */
  read(): CooldownMap;
  /** Mark `model` unusable for `ms` from now. */
  record(model: string, ms: number): void;
}

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
};

/**
 * How long to shelve a model, from the provider's own wording.
 *
 * A `retry-after` header wins when present (it is the standard); otherwise the
 * body is scanned for a `Resets in 1h 5min` style hint. Providers disagree on
 * both, so an unreadable 429 still yields {@link DEFAULT_COOLDOWN_MS} rather
 * than nothing — the point is only to skip a model that just said no.
 */
export function parseCooldownMs(body: string, retryAfterHeader?: string | null): number {
  const headerSeconds = Number(retryAfterHeader?.trim());
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) return clamp(headerSeconds * 1_000);

  const hint = /reset[s]?\s*(?:in|at)?\s*([^.;)\n]{0,40})/i.exec(body)?.[1] ?? '';
  const scanned = hint || (/retry\s*(?:after|in)\s*([^.;)\n]{0,40})/i.exec(body)?.[1] ?? '');
  let total = 0;
  for (const [, amount, unit] of scanned.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) {
    const ms = UNIT_MS[unit!.toLowerCase()];
    if (ms) total += Number(amount) * ms;
  }
  return total > 0 ? clamp(total) : DEFAULT_COOLDOWN_MS;
}

function clamp(ms: number): number {
  return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, Math.round(ms)));
}

/**
 * File-backed store. Writes go through a temp file + rename so two delegations
 * racing each other can never leave a half-written JSON behind (last writer
 * wins, which is fine — entries are independent hints).
 */
export function createCooldownStore(
  path: string = COOLDOWN_PATH,
  now: () => number = Date.now,
): CooldownStore {
  function readAll(): Record<string, number> {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, number> = {};
      for (const [model, until] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof until === 'number' && Number.isFinite(until)) out[model] = until;
      }
      return out;
    } catch {
      return {}; // absent or corrupt: nothing is cooling
    }
  }

  return {
    read() {
      const t = now();
      return Object.fromEntries(Object.entries(readAll()).filter(([, until]) => until > t));
    },

    record(model, ms) {
      const t = now();
      const next = {
        ...Object.fromEntries(Object.entries(readAll()).filter(([, until]) => until > t)),
        [model]: t + clamp(ms),
      };
      try {
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(next, null, 2));
        renameSync(tmp, path);
      } catch {
        // best-effort; a delegation must not fail because the hint file is unwritable
      }
    },
  };
}

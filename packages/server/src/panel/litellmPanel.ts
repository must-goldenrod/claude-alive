/**
 * Multi-model review panel over the litellm gateway.
 *
 * The verification gate and the decision gate both need the same primitive: ask
 * N *independent* models the same question at once and collect whatever each
 * one says. This file is that primitive and nothing more — it does not know what
 * a ticket is, and it never interprets an answer.
 *
 * Two properties matter and are deliberate:
 *  - **Parallel, never serial.** A panel is on the critical path of every ticket
 *    completion; three sequential 60s calls would triple the gate's latency.
 *  - **A member never fails the panel.** A model that times out, 429s, or answers
 *    garbage comes back as a member with `error` set, so the caller can still
 *    reach a verdict from the reviewers that did answer.
 */
import type { LitellmClient } from '../orchestrator/litellmClient.js';
import { buildDelegateChain } from '../orchestrator/delegateModels.js';

/** One reviewer's raw answer. `content` is null when the member did not answer. */
export interface PanelMemberResult {
  /** The model id/alias the panel asked for. */
  model: string;
  /** The model the gateway says actually answered (may differ on a fallback). */
  respondedModel?: string;
  content: string | null;
  error?: string;
}

export interface PanelRequest {
  system: string;
  user: string;
  /** Overrides the panel's default roster. */
  models?: readonly string[];
  timeoutMs?: number;
}

export interface Panel {
  /** The roster this panel uses when a request does not name one. */
  readonly models: readonly string[];
  run(req: PanelRequest): Promise<PanelMemberResult[]>;
}

/**
 * Default roster: three models from three different vendors.
 *
 * Same-family models share the same blind spots, so a panel of Gemini variants
 * would agree with itself and prove nothing. Three is the smallest roster that
 * can produce a 2-of-3 majority when one member abstains.
 */
export const DEFAULT_PANEL_MODELS: readonly string[] = Object.freeze([
  'gemini/gemini-3.1-pro-preview',
  'grok-4.5',
  'kimi-k3',
]);

/** Per-member ceiling. A hung reviewer must not hold a ticket's gate open. */
export const DEFAULT_PANEL_TIMEOUT_MS = 120_000;

/** `CA_PANEL_MODELS=a,b,c` overrides the roster without a rebuild. */
export function resolvePanelModels(env: NodeJS.ProcessEnv): readonly string[] {
  const raw = env.CA_PANEL_MODELS?.trim();
  if (!raw) return DEFAULT_PANEL_MODELS;
  const models = raw.split(',').map((m) => m.trim()).filter(Boolean);
  return models.length > 0 ? Object.freeze(models) : DEFAULT_PANEL_MODELS;
}

/**
 * The models one seat will try, in order.
 *
 * A panel is only worth running if enough seats actually answer, and on a shared
 * gateway the common failure is a 429, not a wrong answer — so a seat falls back
 * the same way a delegation does. Peers already on the roster are removed from
 * the tail: a seat that failed over onto its neighbour's model would cast a
 * second vote from the same model, which is the one thing a panel must not do.
 */
export function seatChain(model: string, roster: readonly string[]): string[] {
  const peers = new Set(roster.filter((m) => m !== model));
  const chain = buildDelegateChain(model).filter((id) => id === model || !peers.has(id));
  return chain.length > 0 ? chain : [model];
}

/**
 * Drop votes that came from the same model twice.
 *
 * Two seats can still land on one model when a roster entry is an alias of
 * another's fallback. Roster order wins; the later seat is recorded as an
 * abstention so the report shows the seat existed and why it did not vote.
 */
export function dedupeByRespondedModel(results: readonly PanelMemberResult[]): PanelMemberResult[] {
  const claimed = new Set<string>();
  return results.map((r) => {
    if (r.content === null) return r;
    const key = r.respondedModel ?? r.model;
    if (claimed.has(key)) {
      return { ...r, content: null, error: `duplicate model (${key}) — vote dropped` };
    }
    claimed.add(key);
    return r;
  });
}

export function createLitellmPanel(
  client: LitellmClient,
  opts: { models?: readonly string[]; timeoutMs?: number; fallbacks?: boolean } = {},
): Panel {
  const roster = opts.models ?? DEFAULT_PANEL_MODELS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PANEL_TIMEOUT_MS;
  const useFallbacks = opts.fallbacks !== false;

  return {
    models: roster,
    async run(req) {
      const models = req.models ?? roster;

      const askSeat = async (model: string): Promise<PanelMemberResult> => {
        const chain = useFallbacks ? seatChain(model, models) : [model];
        let lastError = 'no answer';
        for (const candidate of chain) {
          try {
            const r = await client.chat(
              candidate,
              [
                { role: 'system', content: req.system },
                { role: 'user', content: req.user },
              ],
              { timeoutMs: req.timeoutMs ?? timeoutMs },
            );
            const content = r.content.trim();
            if (content) return { model, respondedModel: r.model ?? candidate, content };
            lastError = 'empty answer';
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
          }
        }
        return { model, content: null, error: lastError };
      };

      return dedupeByRespondedModel(await Promise.all(models.map(askSeat)));
    },
  };
}

/**
 * Pull a JSON object out of a model answer.
 *
 * Reviewers are told to emit bare JSON and mostly do, but every family wraps it
 * differently under load — a ```json fence, a sentence of preamble, or a second
 * object in an explanation. Rejecting those would throw away real votes, so this
 * tries the whole string, then fenced blocks, then the last balanced `{…}`.
 */
export function extractJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const candidates: string[] = [text.trim()];

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  // Balanced-brace scan, last object first: models put the verdict at the end.
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        found.push(text.slice(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        depth = 0;
      }
    }
  }
  candidates.push(...found.reverse());

  for (const c of candidates) {
    try {
      const obj: unknown = JSON.parse(c);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, unknown>;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Read a string field, trimmed, or null when absent/blank/not a string. */
export function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

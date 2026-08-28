/**
 * Per-model token pricing for the Tools > Data dashboard, mirroring how
 * `ccusage` costs Claude Code usage: cost = Σ(tokens × per-token rate) over the
 * four token classes, using the LiteLLM `model_prices_and_context_window.json`
 * rates.
 *
 * Verified 2026-07-23 against LiteLLM: applying these rates to a full day of
 * deduped transcript messages reproduces ccusage's daily cost to $0.00.
 *
 * IMPORTANT — cache creation is a SINGLE bucket priced at `cacheWrite`; we do
 * NOT split ephemeral 1h vs 5m. ccusage prices `cache_creation_input_tokens` as
 * one quantity, and splitting it (1h at 2× input) over-costs by ~7%.
 *
 * Note: Opus 4.5+ is priced at $5/$25 per MTok — one third of the legacy
 * Opus 4.0/4.1 ($15/$75). Using the old rate over-costs Opus 4.8 by ~3×.
 */

/** Per-token USD rates (not per-million). */
export interface ModelRate {
  input: number;
  output: number;
  /** cache_creation_input_tokens rate. */
  cacheWrite: number;
  /** cache_read_input_tokens rate. */
  cacheRead: number;
}

/**
 * Static rate table for models seen in this workspace. Keys are the exact
 * `message.model` strings Claude Code writes (a `[1m]`/`[…]` context suffix is
 * stripped before lookup). Values sourced from LiteLLM.
 */
const MODEL_PRICING: Record<string, ModelRate> = {
  // Opus 4.5 / 4.6 / 4.7 / 4.8 — $5 / $25 per MTok.
  'claude-opus-4-8': { input: 5e-6, output: 25e-6, cacheWrite: 6.25e-6, cacheRead: 5e-7 },
  'claude-opus-4-7': { input: 5e-6, output: 25e-6, cacheWrite: 6.25e-6, cacheRead: 5e-7 },
  'claude-opus-4-6': { input: 5e-6, output: 25e-6, cacheWrite: 6.25e-6, cacheRead: 5e-7 },
  'claude-opus-4-5': { input: 5e-6, output: 25e-6, cacheWrite: 6.25e-6, cacheRead: 5e-7 },
  // Legacy Opus 4.0 / 4.1 — $15 / $75 per MTok.
  'claude-opus-4-1': { input: 15e-6, output: 75e-6, cacheWrite: 18.75e-6, cacheRead: 1.5e-6 },
  'claude-opus-4': { input: 15e-6, output: 75e-6, cacheWrite: 18.75e-6, cacheRead: 1.5e-6 },
  // Sonnet 4.x — $3 / $15 per MTok.
  'claude-sonnet-4-6': { input: 3e-6, output: 15e-6, cacheWrite: 3.75e-6, cacheRead: 3e-7 },
  'claude-sonnet-4-5': { input: 3e-6, output: 15e-6, cacheWrite: 3.75e-6, cacheRead: 3e-7 },
  'claude-sonnet-4': { input: 3e-6, output: 15e-6, cacheWrite: 3.75e-6, cacheRead: 3e-7 },
  // Haiku 4.5 — $1 / $5 per MTok.
  'claude-haiku-4-5-20251001': { input: 1e-6, output: 5e-6, cacheWrite: 1.25e-6, cacheRead: 1e-7 },
  'claude-haiku-4-5': { input: 1e-6, output: 5e-6, cacheWrite: 1.25e-6, cacheRead: 1e-7 },
  // Gemini flash-lite (orchestrator delegations) — negligible, priced for completeness.
  'gemini-2.5-flash-lite': { input: 1e-7, output: 4e-7, cacheWrite: 0, cacheRead: 1e-8 },
};

/** Family fallbacks when an exact model id isn't in the table. */
const FAMILY_FALLBACKS: Array<[RegExp, ModelRate]> = [
  [/opus-4-([5-9]|1\d)/, MODEL_PRICING['claude-opus-4-8']!],
  [/opus/, MODEL_PRICING['claude-opus-4-1']!],
  [/sonnet/, MODEL_PRICING['claude-sonnet-4-5']!],
  [/haiku/, MODEL_PRICING['claude-haiku-4-5']!],
  [/gemini.*flash-lite/, MODEL_PRICING['gemini-2.5-flash-lite']!],
];

/** Normalize a raw `message.model` string: strip a `[…]` context-window suffix
 * and any provider prefix like `gemini/`. */
export function normalizeModel(model: string): string {
  return model.replace(/\[.*\]$/, '').replace(/^.*\//, '');
}

/** Resolve per-token rates for a model, or null when unknown (cost counts as 0). */
export function rateFor(model: string): ModelRate | null {
  const m = normalizeModel(model);
  if (MODEL_PRICING[m]) return MODEL_PRICING[m];
  for (const [re, rate] of FAMILY_FALLBACKS) {
    if (re.test(m)) return rate;
  }
  return null;
}

/** Raw token counts from a message's `usage` object. */
export interface TokenCounts {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/** Cost in USD for one message's token counts under the given model. 0 when the
 * model is unknown. */
export function costOf(tokens: TokenCounts, model: string): number {
  const rate = rateFor(model);
  if (!rate) return 0;
  return (
    tokens.input * rate.input +
    tokens.output * rate.output +
    tokens.cacheCreation * rate.cacheWrite +
    tokens.cacheRead * rate.cacheRead
  );
}

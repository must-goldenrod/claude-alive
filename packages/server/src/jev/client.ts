/**
 * Minimal client for TypeSafe's Jev ("System One") decision API.
 *
 * Every other judgement in this server is a chat completion that is *asked* to
 * answer in JSON: the panels (`panel/`) and the completion gate
 * (`ticketVerifier.ts`) hand a model a prompt ending in "answer with ONE JSON
 * object" and then parse whatever comes back. Two costs follow from that. The
 * answer can arrive in a shape the parser does not accept — measured at 5.3% of
 * verified tickets ending `verification-inconclusive` — and the `confidence`
 * field in those objects is a number the model wrote because it looked
 * plausible, not one that means anything in aggregate.
 *
 * Jev inverts both. The options are enumerated in the *request*, so the response
 * is one of them by construction and there is no free text to parse; and the
 * probabilities are trained against outcomes (RLCD), so a 0.8 is meant to be
 * right about 80% of the time. That is the only reason to add a fourth vendor
 * here: not a better answer, a usable *threshold*.
 *
 * Deliberately no SDK — TypeSafe ships Python only, and the wire format is one
 * POST. `fetch` is injectable so every path below is testable without network,
 * matching `orchestrator/litellmClient.ts`.
 *
 * Probed live 2026-09-22: `POST /v1/systemone`, HTTP 200 in 527ms.
 */

/** Used when `JEV_BASE_URL` is unset. */
export const DEFAULT_JEV_BASE_URL = 'https://api.typesafe.ai';

/**
 * The floating alias. Pinning (`jev-1.13.0`) is deliberate elsewhere: anything
 * whose wording was measured should pin, so an upstream model swap cannot
 * silently invalidate the measurement.
 */
export const DEFAULT_JEV_MODEL = 'jev-latest';

/** Default ceiling for one decision. The API answers in 70-500ms when healthy. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Every failure this module raises, so callers can catch one type and degrade. */
export class JevError extends Error {
  /** HTTP status when the failure came from the API, undefined for local ones. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'JevError';
    if (status !== undefined) this.status = status;
  }
}

/** Yes/no. Returns a bare probability that the statement is true. */
export interface JevNoulQuestion {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
}

/** One of N enumerated options. `criteria` maps option key → what it means. */
export interface JevChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

/** An ordered rubric. `criteria` is the level labels, lowest first. */
export interface JevScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: readonly string[];
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

export interface JevNoulAnswer {
  type: 'noul';
  /** P(statement is true), 0..1. Noul carries no separate confidence field. */
  noul: number;
}

export interface JevChoiceAnswer {
  type: 'choice';
  /** One of the keys the request enumerated — never free text. */
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevScoreAnswer {
  type: 'score';
  /** Weighted mean over the levels, 0..n-1. */
  score: number;
  confidence: number;
  legend?: readonly string[];
  probabilities?: Record<string, number>;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Present on plans that meter requests; absent otherwise. */
export interface JevQuota {
  used?: number;
  limit?: number;
  remaining?: number;
}

export interface JevResult {
  /** The concrete version that answered (`jev-latest` resolves to e.g. `jev-1.13.0`). */
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: JevUsage;
  quota?: JevQuota;
}

/**
 * The material being judged. A string is sent as-is; an object is sent as an
 * object, which is how the API wants multi-part state (goal + report + policy)
 * rather than one concatenated blob.
 */
export type JevState = string | Record<string, unknown>;

export interface JevDecideOptions {
  timeoutMs?: number;
}

export interface JevClientConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
}

export interface JevClient {
  /** The model id this client sends (for recording alongside a verdict). */
  readonly model: string;
  decide(
    state: JevState,
    questions: Record<string, JevQuestion>,
    opts?: JevDecideOptions,
  ): Promise<JevResult>;
}

/** A yes/no question. Both criteria are required: the API scores against them. */
export function noulQuestion(instructions: string, whenTrue: string, whenFalse: string): JevNoulQuestion {
  return { type: 'noul', instructions, criteria: { true: whenTrue, false: whenFalse } };
}

/**
 * A choice over enumerated options.
 *
 * Fewer than two options is rejected rather than sent: a one-option choice
 * always "answers" with confidence 1 and would look like agreement in a
 * consensus tally while carrying no information at all.
 */
export function choiceQuestion(instructions: string, criteria: Record<string, string>): JevChoiceQuestion {
  if (Object.keys(criteria).length < 2) {
    throw new JevError('a choice question needs at least two options');
  }
  return { type: 'choice', instructions, criteria };
}

/** An ordered rubric; labels are lowest level first. */
export function scoreQuestion(instructions: string, levels: readonly string[]): JevScoreQuestion {
  if (levels.length < 2) {
    throw new JevError('a score question needs at least two levels');
  }
  return { type: 'score', instructions, criteria: levels };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown, key: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new JevError(`answer "${key}" has no usable ${field}`);
  }
  return value;
}

function probabilitiesOf(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  const source = asRecord(raw.probabilities);
  if (source) {
    for (const [option, weight] of Object.entries(source)) {
      if (typeof weight === 'number' && Number.isFinite(weight)) out[option] = weight;
    }
  }
  return out;
}

/**
 * Parse one answer against the question that asked for it.
 *
 * The type is checked rather than trusted. A `choice` arriving where a `noul`
 * was asked would otherwise flow on as a plausible object and be read as a
 * decision; the whole point of this client is that the caller gets the shape it
 * asked for or an error.
 */
function parseAnswer(key: string, question: JevQuestion, raw: unknown): JevAnswer {
  const record = asRecord(raw);
  if (!record) throw new JevError(`answer "${key}" is missing from the response`);
  if (record.type !== question.type) {
    throw new JevError(`answer "${key}" has type "${String(record.type)}", asked for "${question.type}"`);
  }

  if (question.type === 'noul') {
    return { type: 'noul', noul: asNumber(record.noul, key, 'noul probability') };
  }

  if (question.type === 'choice') {
    const choice = record.choice;
    if (typeof choice !== 'string' || !(choice in question.criteria)) {
      throw new JevError(`answer "${key}" chose "${String(choice)}", which was not an option`);
    }
    return {
      type: 'choice',
      choice,
      confidence: asNumber(record.confidence, key, 'confidence'),
      probabilities: probabilitiesOf(record),
    };
  }

  const legend = Array.isArray(record.legend) ? record.legend.filter((l): l is string => typeof l === 'string') : undefined;
  return {
    type: 'score',
    score: asNumber(record.score, key, 'score'),
    confidence: asNumber(record.confidence, key, 'confidence'),
    ...(legend && legend.length > 0 ? { legend } : {}),
    ...(record.probabilities ? { probabilities: probabilitiesOf(record) } : {}),
  };
}

function parseUsage(raw: unknown): JevUsage | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const usage: JevUsage = {};
  if (typeof record.input_tokens === 'number') usage.inputTokens = record.input_tokens;
  if (typeof record.output_tokens === 'number') usage.outputTokens = record.output_tokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function parseQuota(raw: unknown): JevQuota | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const quota: JevQuota = {};
  for (const field of ['used', 'limit', 'remaining'] as const) {
    if (typeof record[field] === 'number') quota[field] = record[field] as number;
  }
  return Object.keys(quota).length > 0 ? quota : undefined;
}

export function createJevClient(config: JevClientConfig): JevClient {
  const apiKey = config.apiKey.trim();
  // Unauthenticated calls are not a degraded mode, they are a 401 with the
  // request body already sent — so this fails at construction, not per call.
  if (!apiKey) throw new JevError('a Jev API key is required');

  const baseUrl = (config.baseUrl ?? DEFAULT_JEV_BASE_URL).replace(/\/+$/, '');
  const model = config.model ?? DEFAULT_JEV_MODEL;
  const doFetch = config.fetch ?? fetch;
  const url = `${baseUrl}/v1/systemone`;

  async function decide(
    state: JevState,
    questions: Record<string, JevQuestion>,
    opts: JevDecideOptions = {},
  ): Promise<JevResult> {
    if (Object.keys(questions).length === 0) {
      throw new JevError('at least one question is required');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, state, questions }),
        signal: controller.signal,
      });
    } catch (error) {
      // Network failures and aborts both land here. The cause is named but the
      // request — which carries the key in a header — is never included.
      throw new JevError(`Jev request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw new JevError(`Jev returned HTTP ${response.status}: ${text.slice(0, 300)}`, response.status);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new JevError(`Jev returned a non-JSON body: ${text.slice(0, 120)}`, response.status);
    }

    const body = asRecord(parsed);
    const rawAnswers = body ? asRecord(body.answers) : null;
    if (!rawAnswers) throw new JevError('Jev response carried no answers');

    const answers: Record<string, JevAnswer> = {};
    for (const [key, question] of Object.entries(questions)) {
      answers[key] = parseAnswer(key, question, rawAnswers[key]);
    }

    const usage = parseUsage(body?.usage);
    const quota = parseQuota(body?.quota);
    return {
      model: typeof body?.model === 'string' ? body.model : model,
      answers,
      ...(usage ? { usage } : {}),
      ...(quota ? { quota } : {}),
    };
  }

  return { model, decide };
}

/**
 * Build a client from the server env, or `undefined` when no key is configured.
 *
 * Undefined rather than throwing, because that is what every consumer here does
 * with a missing key already (`panel?` on the verifier): no key means the Jev
 * seat is simply absent and the surrounding behaviour is exactly the pre-Jev
 * one. The key lives in `~/.claude-alive/.env` (see `serverEnv.ts`) so the
 * detached daemon can read it, and never reaches the browser.
 */
export function jevClientFromEnv(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): JevClient | undefined {
  const apiKey = (env.TYPESAFE_API_KEY ?? '').trim();
  if (!apiKey) return undefined;
  return createJevClient({
    apiKey,
    ...(env.JEV_BASE_URL ? { baseUrl: env.JEV_BASE_URL } : {}),
    ...(env.JEV_MODEL ? { model: env.JEV_MODEL } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

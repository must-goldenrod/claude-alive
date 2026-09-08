/**
 * Minimal OpenAI-compatible client for the litellm gateway (spec §4).
 *
 * Used two ways: a connectivity check (list models) for the onboarding surface,
 * and chat completion for the `ca-delegate` sub-agent tool. The API key lives in
 * server env only and is never sent to the browser. `fetch` is injectable so the
 * client is testable without network.
 */
import { randomUUID } from 'node:crypto';

export interface LitellmConfig {
  baseUrl: string;
  apiKey: string;
  /**
   * Session id forwarded to the gateway as `x-opencode-session` (see
   * {@link SESSION_HEADER}). Defaults to a per-client random id.
   */
  sessionId?: string;
}

/**
 * Some upstreams behind the gateway (the grok and kimi routes as of 2026-09-08)
 * reject a request that carries no session id with HTTP 400 "MissingSessionID",
 * and the header cannot be set on the HTTP request itself — litellm drops
 * client headers and only forwards what the body's `extra_headers` names. So it
 * travels in the body. Models that do not need it ignore it.
 */
export const SESSION_HEADER = 'x-opencode-session';

export interface LitellmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LitellmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LitellmChatResult {
  content: string;
  model?: string;
  usage?: LitellmUsage;
}

export interface LitellmCheckResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

export interface LitellmChatOptions {
  /** Abort the request after this many ms (a hung model must not block a delegation forever). */
  timeoutMs?: number;
}

export interface LitellmClient {
  checkConnection(): Promise<LitellmCheckResult>;
  chat(model: string, messages: LitellmMessage[], opts?: LitellmChatOptions): Promise<LitellmChatResult>;
}

/**
 * A non-2xx answer from the gateway, carrying the bits a caller needs to decide
 * whether to retry on another model: the status and the raw body (429s state
 * their own reset window in prose) plus `retry-after` when the gateway sends it.
 */
export class LitellmHttpError extends Error {
  readonly name = 'LitellmHttpError';
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryAfter: string | null = null,
  ) {
    super(`litellm chat failed (HTTP ${status}): ${body.slice(0, 300)}`);
  }
}

type FetchFn = typeof fetch;

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export function createLitellmClient(config: LitellmConfig, deps: { fetch?: FetchFn } = {}): LitellmClient {
  const doFetch = deps.fetch ?? fetch;
  const base = trimBase(config.baseUrl);
  const authHeaders = { Authorization: `Bearer ${config.apiKey}` };
  const sessionId = config.sessionId?.trim() || `claude-alive-${randomUUID()}`;
  const extraHeaders = { [SESSION_HEADER]: sessionId };

  return {
    async checkConnection() {
      try {
        const res = await doFetch(`${base}/v1/models`, { headers: authHeaders });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const body = (await res.json()) as { data?: Array<{ id?: string }> };
        const models = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
        return { ok: true, models };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'connection failed' };
      }
    },

    async chat(model, messages, opts = {}) {
      const res = await doFetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, extra_headers: extraHeaders }),
        ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new LitellmHttpError(res.status, text, res.headers?.get?.('retry-after') ?? null);
      }
      const body = (await res.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      return {
        content: body.choices?.[0]?.message?.content ?? '',
        model: body.model,
        usage: body.usage
          ? {
              promptTokens: body.usage.prompt_tokens,
              completionTokens: body.usage.completion_tokens,
              totalTokens: body.usage.total_tokens,
            }
          : undefined,
      };
    },
  };
}

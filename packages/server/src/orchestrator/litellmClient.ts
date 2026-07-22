/**
 * Minimal OpenAI-compatible client for the litellm gateway (spec §4).
 *
 * Used two ways: a connectivity check (list models) for the onboarding surface,
 * and chat completion for the `ca-delegate` sub-agent tool. The API key lives in
 * server env only and is never sent to the browser. `fetch` is injectable so the
 * client is testable without network.
 */
export interface LitellmConfig {
  baseUrl: string;
  apiKey: string;
}

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

export interface LitellmClient {
  checkConnection(): Promise<LitellmCheckResult>;
  chat(model: string, messages: LitellmMessage[]): Promise<LitellmChatResult>;
}

type FetchFn = typeof fetch;

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export function createLitellmClient(config: LitellmConfig, deps: { fetch?: FetchFn } = {}): LitellmClient {
  const doFetch = deps.fetch ?? fetch;
  const base = trimBase(config.baseUrl);
  const authHeaders = { Authorization: `Bearer ${config.apiKey}` };

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

    async chat(model, messages) {
      const res = await doFetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`litellm chat failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
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

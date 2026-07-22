import { describe, it, expect } from 'vitest';
import { createLitellmClient } from '../litellmClient.js';
import { createBackendRegistry } from '../backends.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('createLitellmClient', () => {
  it('checkConnection lists model ids on success', async () => {
    const client = createLitellmClient(
      { baseUrl: 'https://gw.example/', apiKey: 'k' },
      { fetch: (async (url: string) => {
        expect(url).toBe('https://gw.example/v1/models');
        return jsonResponse({ data: [{ id: 'gemini/a' }, { id: 'gemini/b' }, {}] });
      }) as typeof fetch },
    );
    const r = await client.checkConnection();
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(['gemini/a', 'gemini/b']);
  });

  it('checkConnection reports HTTP errors', async () => {
    const client = createLitellmClient(
      { baseUrl: 'https://gw.example', apiKey: 'k' },
      { fetch: (async () => jsonResponse({}, false, 401)) as typeof fetch },
    );
    expect(await client.checkConnection()).toEqual({ ok: false, error: 'HTTP 401' });
  });

  it('chat returns content + usage', async () => {
    const client = createLitellmClient(
      { baseUrl: 'https://gw.example', apiKey: 'k' },
      { fetch: (async (_url: string, init: RequestInit) => {
        expect(JSON.parse(init.body as string).model).toBe('gemini/x');
        return jsonResponse({
          model: 'gemini/x',
          choices: [{ message: { content: 'hello' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        });
      }) as typeof fetch },
    );
    const r = await client.chat('gemini/x', [{ role: 'user', content: 'hi' }]);
    expect(r.content).toBe('hello');
    expect(r.usage).toEqual({ promptTokens: 3, completionTokens: 2, totalTokens: 5 });
  });
});

describe('createBackendRegistry', () => {
  const litellm = createLitellmClient(
    { baseUrl: 'https://gw.example', apiKey: 'k' },
    { fetch: (async () => jsonResponse({ data: [{ id: 'm1' }, { id: 'm2' }] })) as typeof fetch },
  );

  it('lists claude-local + ssh always, litellm only when configured', () => {
    expect(createBackendRegistry({}).list().map((b) => b.id)).toEqual(['claude-local', 'ssh']);
    expect(createBackendRegistry({ litellm }).list().map((b) => b.id)).toEqual(['claude-local', 'litellm', 'ssh']);
  });

  it('checks claude-local via findClaude', async () => {
    const ok = await createBackendRegistry({ findClaude: () => '/usr/bin/claude' }).check('claude-local');
    expect(ok.connected).toBe(true);
    const no = await createBackendRegistry({ findClaude: () => null }).check('claude-local');
    expect(no.connected).toBe(false);
  });

  it('checks litellm connectivity + model count', async () => {
    const r = await createBackendRegistry({ litellm }).check('litellm');
    expect(r.connected).toBe(true);
    expect(r.models).toEqual(['m1', 'm2']);
    expect(r.detail).toBe('2 models');
  });

  it('reports litellm not configured', async () => {
    const r = await createBackendRegistry({}).check('litellm');
    expect(r.connected).toBe(false);
    expect(r.detail).toContain('not configured');
  });
});

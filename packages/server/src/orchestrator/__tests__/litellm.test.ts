import { describe, it, expect } from 'vitest';
import { createLitellmClient, SESSION_HEADER } from '../litellmClient.js';
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

  // The grok/kimi-k3 routes answer 400 "MissingSessionID"; the glm routes answer
  // 500 when the field IS present. So: plain first, session id only on demand.
  it('chat sends no session id on the first attempt', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = createLitellmClient(
      { baseUrl: 'https://gw.example', apiKey: 'k', sessionId: 'ses-42' },
      { fetch: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
      }) as typeof fetch },
    );
    await client.chat('glm-5.3', [{ role: 'user', content: 'hi' }]);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('extra_headers');
  });

  it('chat retries once with a session id when the gateway asks for one', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = createLitellmClient(
      { baseUrl: 'https://gw.example', apiKey: 'k', sessionId: 'ses-42' },
      { fetch: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return bodies.length === 1
          ? jsonResponse({ error: { message: 'MissingSessionID' } }, false, 400)
          : jsonResponse({ choices: [{ message: { content: 'ok' } }] });
      }) as typeof fetch },
    );
    const r = await client.chat('kimi-k3', [{ role: 'user', content: 'hi' }]);
    expect(r.content).toBe('ok');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.extra_headers).toEqual({ [SESSION_HEADER]: 'ses-42' });
  });

  it('chat generates a session id when none is configured', async () => {
    const bodies: Array<{ extra_headers?: Record<string, string> }> = [];
    const client = createLitellmClient(
      { baseUrl: 'https://gw.example', apiKey: 'k' },
      { fetch: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return bodies.length === 1
          ? jsonResponse({ error: { message: 'MissingSessionID' } }, false, 400)
          : jsonResponse({ choices: [{ message: { content: 'ok' } }] });
      }) as typeof fetch },
    );
    await client.chat('grok-4.5', [{ role: 'user', content: 'hi' }]);
    expect(bodies[1]?.extra_headers?.[SESSION_HEADER]).toMatch(/^claude-alive-/);
  });

  it('chat does not retry a 400 that is about something else', async () => {
    let calls = 0;
    const client = createLitellmClient(
      { baseUrl: 'https://gw.example', apiKey: 'k' },
      { fetch: (async () => {
        calls += 1;
        return jsonResponse({ error: { message: 'Invalid model name' } }, false, 400);
      }) as typeof fetch },
    );
    await expect(client.chat('nope', [{ role: 'user', content: 'hi' }])).rejects.toThrow(/HTTP 400/);
    expect(calls).toBe(1);
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

  it('lists claude-local always and litellm only when configured; ssh is not a card', () => {
    expect(createBackendRegistry({}).list().map((b) => b.id)).toEqual(['claude-local']);
    expect(createBackendRegistry({ litellm }).list().map((b) => b.id)).toEqual(['claude-local', 'litellm']);
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

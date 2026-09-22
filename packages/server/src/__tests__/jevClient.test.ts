import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_JEV_BASE_URL,
  DEFAULT_JEV_MODEL,
  JevError,
  createJevClient,
  jevClientFromEnv,
  noulQuestion,
  choiceQuestion,
  scoreQuestion,
} from '../jev/client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const OK_BODY = {
  model: 'jev-1.13.0',
  answers: {
    met: { type: 'noul', noul: 0.06 },
    route: {
      type: 'choice',
      choice: 'technical',
      confidence: 1,
      probabilities: { billing: 0, sales: 0, technical: 1 },
    },
  },
  usage: { input_tokens: 396, output_tokens: 54 },
};

describe('createJevClient — request', () => {
  it('posts to /v1/systemone with the bearer key and the default model', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OK_BODY));
    const client = createJevClient({ apiKey: 'k-1', fetch: fetchMock });

    await client.decide('state text', { met: noulQuestion('Met?', 'yes', 'no') });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${DEFAULT_JEV_BASE_URL}/v1/systemone`);
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer k-1');
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe(DEFAULT_JEV_MODEL);
    expect(body.state).toBe('state text');
    expect(body.questions.met).toEqual({
      type: 'noul',
      instructions: 'Met?',
      criteria: { true: 'yes', false: 'no' },
    });
  });

  it('passes a structured state through as an object, not a string', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OK_BODY));
    const client = createJevClient({ apiKey: 'k', fetch: fetchMock });

    await client.decide({ goal: 'g', report: 'r' }, { met: noulQuestion('Met?', 'y', 'n') });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.state).toEqual({ goal: 'g', report: 'r' });
  });

  it('honours an explicit model and base url', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OK_BODY));
    const client = createJevClient({
      apiKey: 'k',
      baseUrl: 'https://proxy.example/',
      model: 'jev-1.13.0',
      fetch: fetchMock,
    });

    await client.decide('s', { met: noulQuestion('Met?', 'y', 'n') });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://proxy.example/v1/systemone');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).model).toBe('jev-1.13.0');
  });

  it('refuses to build a client without a key rather than calling unauthenticated', () => {
    expect(() => createJevClient({ apiKey: '  ' })).toThrow(JevError);
  });
});

describe('createJevClient — question builders', () => {
  it('builds a choice question from an option map', () => {
    expect(choiceQuestion('Which team?', { billing: 'Payments', technical: 'Bugs' })).toEqual({
      type: 'choice',
      instructions: 'Which team?',
      criteria: { billing: 'Payments', technical: 'Bugs' },
    });
  });

  it('builds a score question from ordered level labels', () => {
    expect(scoreQuestion('How hard?', ['trivial', 'normal', 'hard'])).toEqual({
      type: 'score',
      instructions: 'How hard?',
      criteria: ['trivial', 'normal', 'hard'],
    });
  });

  it('rejects a choice with fewer than two options — there is nothing to decide', () => {
    expect(() => choiceQuestion('Which?', { only: 'one' })).toThrow(JevError);
  });
});

describe('createJevClient — response', () => {
  it('parses noul and choice answers', async () => {
    const client = createJevClient({ apiKey: 'k', fetch: async () => jsonResponse(OK_BODY) });

    const result = await client.decide('s', {
      met: noulQuestion('Met?', 'y', 'n'),
      route: choiceQuestion('Team?', { billing: 'b', technical: 't', sales: 's' }),
    });

    expect(result.model).toBe('jev-1.13.0');
    expect(result.answers.met).toEqual({ type: 'noul', noul: 0.06 });
    expect(result.answers.route).toEqual({
      type: 'choice',
      choice: 'technical',
      confidence: 1,
      probabilities: { billing: 0, sales: 0, technical: 1 },
    });
    expect(result.usage).toEqual({ inputTokens: 396, outputTokens: 54 });
  });

  it('parses a score answer with its legend', async () => {
    const client = createJevClient({
      apiKey: 'k',
      fetch: async () =>
        jsonResponse({
          model: 'jev-1.13.0',
          answers: {
            difficulty: {
              type: 'score',
              score: 1.4,
              confidence: 0.7,
              legend: ['trivial', 'normal', 'hard'],
              probabilities: { trivial: 0.1, normal: 0.4, hard: 0.5 },
            },
          },
        }),
    });

    const result = await client.decide('s', { difficulty: scoreQuestion('How hard?', ['trivial', 'normal', 'hard']) });

    expect(result.answers.difficulty).toMatchObject({ type: 'score', score: 1.4, confidence: 0.7 });
  });

  it('exposes the quota block when the API sends one', async () => {
    const client = createJevClient({
      apiKey: 'k',
      fetch: async () =>
        jsonResponse({ ...OK_BODY, quota: { used: 1, limit: 50, remaining: 49 } }),
    });

    const result = await client.decide('s', { met: noulQuestion('Met?', 'y', 'n') });

    expect(result.quota).toEqual({ used: 1, limit: 50, remaining: 49 });
  });

  it('throws when an answer the caller asked for is missing', async () => {
    const client = createJevClient({
      apiKey: 'k',
      fetch: async () => jsonResponse({ model: 'jev-1.13.0', answers: {} }),
    });

    await expect(client.decide('s', { met: noulQuestion('Met?', 'y', 'n') })).rejects.toThrow(JevError);
  });

  it('throws when an answer comes back as a different type than asked', async () => {
    const client = createJevClient({
      apiKey: 'k',
      fetch: async () =>
        jsonResponse({ model: 'jev-1.13.0', answers: { met: { type: 'choice', choice: 'x', confidence: 1, probabilities: {} } } }),
    });

    await expect(client.decide('s', { met: noulQuestion('Met?', 'y', 'n') })).rejects.toThrow(/type/i);
  });
});

describe('createJevClient — failures', () => {
  it('reports the HTTP status and never echoes the key', async () => {
    const client = createJevClient({
      apiKey: 'super-secret-key',
      fetch: async () => new Response('{"error":"bad request"}', { status: 400 }),
    });

    const error = await client.decide('s', { met: noulQuestion('Met?', 'y', 'n') }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).status).toBe(400);
    expect((error as JevError).message).toContain('400');
    expect((error as JevError).message).not.toContain('super-secret-key');
  });

  it('wraps a network failure instead of leaking the raw error', async () => {
    const client = createJevClient({
      apiKey: 'k',
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    await expect(client.decide('s', { met: noulQuestion('Met?', 'y', 'n') })).rejects.toThrow(JevError);
  });

  it('aborts a request that outruns the timeout', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const client = createJevClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });

    await expect(
      client.decide('s', { met: noulQuestion('Met?', 'y', 'n') }, { timeoutMs: 5 }),
    ).rejects.toThrow(JevError);
  });

  it('throws on a body that is not JSON', async () => {
    const client = createJevClient({ apiKey: 'k', fetch: async () => new Response('<html>502</html>', { status: 200 }) });

    await expect(client.decide('s', { met: noulQuestion('Met?', 'y', 'n') })).rejects.toThrow(JevError);
  });
});

describe('jevClientFromEnv', () => {
  it('returns undefined when the key is absent, so callers degrade instead of crashing', () => {
    expect(jevClientFromEnv({})).toBeUndefined();
    expect(jevClientFromEnv({ TYPESAFE_API_KEY: '' })).toBeUndefined();
  });

  it('builds a client from TYPESAFE_API_KEY and honours the base url and model overrides', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OK_BODY));
    const client = jevClientFromEnv(
      { TYPESAFE_API_KEY: 'k', JEV_BASE_URL: 'https://proxy.example', JEV_MODEL: 'jev-preview' },
      fetchMock,
    );

    await client!.decide('s', { met: noulQuestion('Met?', 'y', 'n') });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://proxy.example/v1/systemone');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).model).toBe('jev-preview');
  });
});

describe('createJevClient — retry', () => {
  /** Immediate sleep so the retry path is exercised without a real delay. */
  const noSleep = async (): Promise<void> => {};

  it('retries once on 429 and returns the retried answer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));
    const client = createJevClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch, sleep: noSleep });

    const result = await client.decide('s', { met: noulQuestion('Met?', 'y', 'n') });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.answers.met).toEqual({ type: 'noul', noul: 0.06 });
  });

  it('retries once on a 5xx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));
    const client = createJevClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch, sleep: noSleep });

    await client.decide('s', { met: noulQuestion('Met?', 'y', 'n') });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 — a malformed request is malformed twice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    const client = createJevClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch, sleep: noSleep });

    await expect(client.decide('s', { met: noulQuestion('Met?', 'y', 'n') })).rejects.toThrow(JevError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the single retry rather than looping', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    const client = createJevClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch, sleep: noSleep });

    const error = await client.decide('s', { met: noulQuestion('Met?', 'y', 'n') }).catch((e: unknown) => e);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((error as JevError).status).toBe(429);
  });

  it('honours Retry-After when the server sends one', async () => {
    const waits: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));
    const client = createJevClient({
      apiKey: 'k',
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    });

    await client.decide('s', { met: noulQuestion('Met?', 'y', 'n') });

    expect(waits).toEqual([2000]);
  });
})

describe('createJevClient — choice validation', () => {
  it('refuses an inherited property name as a choice', async () => {
    const client = createJevClient({
      apiKey: 'k',
      fetch: async () =>
        jsonResponse({
          model: 'jev-1.13.0',
          answers: { route: { type: 'choice', choice: 'toString', confidence: 1, probabilities: {} } },
        }),
    });

    await expect(
      client.decide('s', { route: choiceQuestion('Team?', { billing: 'b', technical: 't' }) }),
    ).rejects.toThrow(/not an option/);
  });
});

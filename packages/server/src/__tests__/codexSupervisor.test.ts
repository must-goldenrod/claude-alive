import { describe, expect, test } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createCodexSupervisor, type CodexProcessHandle } from '../codexSupervisor.js';

/** Fake app-server: streams we drive by hand, so no Codex install is needed. */
function fakeProcess() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const events = new EventEmitter();
  const handle: CodexProcessHandle = {
    stdin,
    stdout,
    stderr,
    kill: () => events.emit('exit'),
    onExit: (cb) => events.on('exit', cb),
  };
  const writtenLines = (): unknown[] => [];
  return { handle, stdin, stdout, stderr, events, writtenLines };
}

/** Collect what the supervisor writes to the process stdin. */
function captureStdin(stdin: PassThrough): () => Record<string, unknown>[] {
  const chunks: string[] = [];
  stdin.on('data', (c) => chunks.push(c.toString()));
  return () =>
    chunks
      .join('')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('framing', () => {
  test('parses newline-delimited JSON split across chunks', async () => {
    const { handle, stdout } = fakeProcess();
    const sup = createCodexSupervisor({ spawnProcess: () => handle });
    const received: unknown[] = [];
    void (async () => {
      for await (const m of sup.messages()) received.push(m);
    })();

    stdout.write('{"method":"thread/star');
    stdout.write('ted","params":{}}\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual([{ method: 'thread/started', params: {} }]);
    sup.stop();
  });

  test('parses several messages arriving in one chunk', async () => {
    const { handle, stdout } = fakeProcess();
    const sup = createCodexSupervisor({ spawnProcess: () => handle });
    const received: unknown[] = [];
    void (async () => {
      for await (const m of sup.messages()) received.push(m);
    })();

    stdout.write('{"method":"a","params":{}}\n{"method":"b","params":{}}\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toHaveLength(2);
    sup.stop();
  });

  test('a malformed line is skipped without killing the stream', async () => {
    const { handle, stdout } = fakeProcess();
    const sup = createCodexSupervisor({ spawnProcess: () => handle });
    const received: unknown[] = [];
    void (async () => {
      for await (const m of sup.messages()) received.push(m);
    })();

    stdout.write('not json\n{"method":"ok","params":{}}\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual([{ method: 'ok', params: {} }]);
    sup.stop();
  });
});

describe('handshake', () => {
  test('sends initialize with client info and resolves on the response', async () => {
    const { handle, stdin, stdout } = fakeProcess();
    const written = captureStdin(stdin);
    const sup = createCodexSupervisor({
      spawnProcess: () => handle,
      clientInfo: { name: 'claude-alive', version: '0.5.9' },
    });

    const started = sup.start();
    await new Promise((r) => setTimeout(r, 10));
    const first = written()[0];
    expect(first).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { clientInfo: { name: 'claude-alive', version: '0.5.9' } },
    });

    stdout.write(JSON.stringify({ id: first.id, result: { codexHome: '/home/.codex' } }) + '\n');
    await expect(started).resolves.toMatchObject({ codexHome: '/home/.codex' });
    sup.stop();
  });

  test('sends the initialized notification after the handshake', async () => {
    const { handle, stdin, stdout } = fakeProcess();
    const written = captureStdin(stdin);
    const sup = createCodexSupervisor({ spawnProcess: () => handle });

    const started = sup.start();
    await new Promise((r) => setTimeout(r, 10));
    stdout.write(JSON.stringify({ id: written()[0].id, result: {} }) + '\n');
    await started;

    expect(written().some((m) => m.method === 'initialized')).toBe(true);
    sup.stop();
  });

  test('an error response rejects rather than hanging', async () => {
    const { handle, stdin, stdout } = fakeProcess();
    const written = captureStdin(stdin);
    const sup = createCodexSupervisor({ spawnProcess: () => handle });

    const started = sup.start();
    await new Promise((r) => setTimeout(r, 10));
    stdout.write(JSON.stringify({ id: written()[0].id, error: { message: 'nope' } }) + '\n');
    await expect(started).rejects.toThrow(/nope/);
    sup.stop();
  });
});

describe('requests and notifications', () => {
  test('responses resolve the matching request only', async () => {
    const { handle, stdin, stdout } = fakeProcess();
    const written = captureStdin(stdin);
    const sup = createCodexSupervisor({ spawnProcess: () => handle });

    const a = sup.request('thread/start', { cwd: '/x' });
    const b = sup.request('thread/read', { id: 't' });
    await new Promise((r) => setTimeout(r, 10));
    const [ra, rb] = written();

    stdout.write(JSON.stringify({ id: rb.id, result: { which: 'b' } }) + '\n');
    await expect(b).resolves.toMatchObject({ which: 'b' });
    stdout.write(JSON.stringify({ id: ra.id, result: { which: 'a' } }) + '\n');
    await expect(a).resolves.toMatchObject({ which: 'a' });
    sup.stop();
  });

  test('a response is not delivered to the message stream', async () => {
    const { handle, stdin, stdout } = fakeProcess();
    const written = captureStdin(stdin);
    const sup = createCodexSupervisor({ spawnProcess: () => handle });
    const received: unknown[] = [];
    void (async () => {
      for await (const m of sup.messages()) received.push(m);
    })();

    void sup.request('thread/start', {});
    await new Promise((r) => setTimeout(r, 10));
    stdout.write(JSON.stringify({ id: written()[0].id, result: {} }) + '\n');
    stdout.write('{"method":"turn/started","params":{}}\n');
    await new Promise((r) => setTimeout(r, 10));

    expect(received).toEqual([{ method: 'turn/started', params: {} }]);
    sup.stop();
  });
});

describe('timeouts', () => {
  test('a request that is never answered rejects instead of hanging forever', async () => {
    // Found against the real binary: `app/list` never replied, and without a
    // timeout the caller would wait indefinitely.
    const { handle } = fakeProcess();
    const sup = createCodexSupervisor({ spawnProcess: () => handle, requestTimeoutMs: 30 });
    await expect(sup.request('app/list', {})).rejects.toThrow(/timed out/i);
    sup.stop();
  });

  test('an answered request does not reject after the timeout window', async () => {
    const { handle, stdin, stdout } = fakeProcess();
    const written = captureStdin(stdin);
    const sup = createCodexSupervisor({ spawnProcess: () => handle, requestTimeoutMs: 50 });
    const p = sup.request('config/read', {});
    await new Promise((r) => setTimeout(r, 10));
    stdout.write(JSON.stringify({ id: written()[0].id, result: { ok: true } }) + '\n');
    await expect(p).resolves.toMatchObject({ ok: true });
    await new Promise((r) => setTimeout(r, 60));
    sup.stop();
  });
});

describe('lifecycle', () => {
  test('process exit ends the message stream instead of hanging', async () => {
    const { handle, events } = fakeProcess();
    const sup = createCodexSupervisor({ spawnProcess: () => handle });
    const done = (async () => {
      for await (const _ of sup.messages()) {
        // drain
      }
      return 'ended';
    })();
    events.emit('exit');
    await expect(done).resolves.toBe('ended');
  });

  test('process exit rejects in-flight requests rather than leaking them', async () => {
    const { handle, events } = fakeProcess();
    const sup = createCodexSupervisor({ spawnProcess: () => handle });
    const pending = sup.request('thread/start', {});
    events.emit('exit');
    await expect(pending).rejects.toThrow(/exited/i);
  });
});

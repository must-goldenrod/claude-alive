import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ticket } from '@claude-alive/core';
import { createTicketStore, type TicketStore } from '../ticketStore.js';
import { createTicketRunner, isCwdAllowed, extractHeadline, extractDecision, type MainOutcome, type TicketRunnerOptions, type SpawnMainOpts } from '../ticketRunner.js';

let dir: string;
let store: TicketStore;
let clock = 0;
const now = () => (clock += 100);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function okOutcome(result = 'ok'): MainOutcome {
  return { exitCode: 0, result: { result, isError: false }, sessionId: 'sess', stderr: '' };
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function makeRunner(overrides: Partial<TicketRunnerOptions>) {
  const broadcasts: Ticket[] = [];
  const runner = createTicketRunner({
    store,
    broadcast: (t) => broadcasts.push(t),
    spawnMain: () => ({ kill() {}, done: Promise.resolve(okOutcome()) }),
    verify: async () => ({ passed: true, reason: 'ok' }),
    now,
    setTimer: () => () => {},
    canonicalize: (p) => p, // identity keeps the allowlist tests off the real fs
    cwdExists: () => true, // tests use synthetic paths like /repo
    ...overrides,
  });
  return { runner, broadcasts };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ticketrunner-'));
  store = createTicketStore({ filePath: join(dir, 't.json'), now, uuid: (() => { let n = 0; return () => `id-${++n}`; })() });
  clock = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('isCwdAllowed', () => {
  it('is unrestricted when no roots given', () => {
    expect(isCwdAllowed('/anywhere', undefined)).toBe(true);
    expect(isCwdAllowed('/anywhere', [])).toBe(true);
  });
  it('allows only paths within a root (boundary-aware)', () => {
    expect(isCwdAllowed('/home/user/repo', ['/home/user'])).toBe(true);
    expect(isCwdAllowed('/home/user', ['/home/user'])).toBe(true);
    expect(isCwdAllowed('/home/userevil', ['/home/user'])).toBe(false);
    expect(isCwdAllowed('/etc', ['/home/user'])).toBe(false);
  });
  it('rejects traversal via .. segments', () => {
    expect(isCwdAllowed('/home/user/../../etc', ['/home/user'])).toBe(false);
    expect(isCwdAllowed('/home/user/sub/../ok', ['/home/user'])).toBe(false); // any .. is refused
  });
});

describe('extractHeadline', () => {
  it('lifts the HEADLINE line out of the body', () => {
    expect(extractHeadline('Detailed report.\nmore\nHEADLINE: 빌드 통과, 3건 수정')).toEqual({
      headline: '빌드 통과, 3건 수정',
      body: 'Detailed report.\nmore',
    });
  });
  it('returns null headline when absent', () => {
    expect(extractHeadline('just a body')).toEqual({ headline: null, body: 'just a body' });
    expect(extractHeadline(null)).toEqual({ headline: null, body: null });
  });
});

describe('extractDecision', () => {
  it('lifts the DECISION line out of the body', () => {
    expect(extractDecision('some context\nDECISION: A안 vs B안 중 선택')).toEqual({
      question: 'A안 vs B안 중 선택',
      body: 'some context',
    });
  });
  it('returns null question when absent', () => {
    expect(extractDecision('no marker here')).toEqual({ question: null, body: 'no marker here' });
    expect(extractDecision(null)).toEqual({ question: null, body: null });
  });
});

describe('TicketRunner decision + reply', () => {
  const decisionOutcome = (q: string, usage?: Record<string, number>): MainOutcome => ({
    exitCode: 0,
    result: { result: `context\nDECISION: ${q}`, isError: false, usage },
    sessionId: 'sess',
    stderr: '',
  });
  const doneOutcome = (h: string, usage?: Record<string, number>): MainOutcome => ({
    exitCode: 0,
    result: { result: `body\nHEADLINE: ${h}`, isError: false, usage },
    sessionId: 'sess',
    stderr: '',
  });

  it('parks at decision (not failed) and holds no slot', async () => {
    const { runner, broadcasts } = makeRunner({
      spawnMain: () => ({ kill() {}, done: Promise.resolve(decisionOutcome('A안 vs B안?')) }),
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'decision');
    const d = store.get(t.id)!;
    expect(d.decisionQuestion).toBe('A안 vs B안?');
    expect(d.rounds).toBe(1);
    expect(runner.activeCount()).toBe(0);
    expect(broadcasts.map((b) => b.state)).toEqual(['running', 'decision']);
  });

  it('reply resumes the session, completes, and accumulates usage + rounds', async () => {
    const outcomes = [
      decisionOutcome('A안 vs B안?', { totalTokens: 100, costUsd: 0.1, numTurns: 2 }),
      doneOutcome('B안으로 완료', { totalTokens: 50, costUsd: 0.05, numTurns: 1 }),
    ];
    const calls: (SpawnMainOpts | undefined)[] = [];
    const { runner } = makeRunner({
      spawnMain: (_ticket, opts) => {
        calls.push(opts);
        return { kill() {}, done: Promise.resolve(outcomes.shift()!) };
      },
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'decision');
    await runner.reply(t.id, 'B안으로 가자');
    await until(() => store.get(t.id)?.state === 'done');
    const f = store.get(t.id)!;
    expect(f.usage?.totalTokens).toBe(150);
    expect(f.usage?.costUsd).toBeCloseTo(0.15);
    expect(f.usage?.numTurns).toBe(3);
    expect(f.rounds).toBe(2);
    expect(calls[1]?.resumeSessionId).toBe('sess');
    expect(calls[1]?.prompt).toBe('B안으로 가자');
    expect(f.turns?.map((x) => x.kind)).toEqual(['decision', 'prompt', 'result']);
  });

  it('a reply can lead to another decision', async () => {
    const outcomes = [decisionOutcome('q1?'), decisionOutcome('q2?')];
    const { runner } = makeRunner({
      spawnMain: () => ({ kill() {}, done: Promise.resolve(outcomes.shift()!) }),
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.decisionQuestion === 'q1?');
    await runner.reply(t.id, 'answer 1');
    await until(() => store.get(t.id)?.decisionQuestion === 'q2?');
    expect(store.get(t.id)?.state).toBe('decision');
    expect(store.get(t.id)?.rounds).toBe(2);
  });

  it('reply on a non-decision ticket is a no-op', async () => {
    const { runner } = makeRunner({});
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'done');
    await runner.reply(t.id, 'ignored');
    expect(store.get(t.id)?.state).toBe('done');
  });
});

describe('TicketRunner lifecycle', () => {
  it('drives a ticket queued → running → verifying → done, capturing headline + model', async () => {
    const { runner, broadcasts } = makeRunner({
      spawnMain: () => ({
        kill() {},
        done: Promise.resolve({
          exitCode: 0,
          result: { result: 'Full body here.\nHEADLINE: 한 줄 요약', isError: false, model: 'claude-opus-4-8' },
          sessionId: 'sess',
          stderr: '',
        }),
      }),
      verify: async () => ({ passed: true, reason: 'looks good' }),
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    // Wait on the terminal broadcast, not the store state: `apply` persists the
    // 'done' state (making store.get observable) one microtask before it emits
    // the broadcast, so waiting on state can assert the broadcast list before
    // the final 'done' event lands (flaky under CI timing).
    await until(() => broadcasts.some((b) => b.state === 'done'));

    const final = store.get(t.id)!;
    expect(final.result).toBe('Full body here.');
    expect(final.headline).toBe('한 줄 요약');
    expect(final.model).toBe('claude-opus-4-8');
    expect(final.verification).toEqual({ passed: true, reason: 'looks good' });
    expect(final.claudeSessionId).toBe('sess');
    expect(broadcasts.map((b) => b.state)).toEqual(['running', 'verifying', 'done']);
  });

  it('fails when the main agent exits non-zero', async () => {
    const { runner } = makeRunner({
      spawnMain: () => ({ kill() {}, done: Promise.resolve({ exitCode: 1, result: null, sessionId: null, stderr: 'boom' }) }),
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'failed');
    expect(store.get(t.id)).toMatchObject({ failureReason: 'error', error: 'boom' });
  });

  it('fails verification-failed when the verifier rejects the goal', async () => {
    const { runner } = makeRunner({ verify: async () => ({ passed: false, reason: 'tests still red' }) });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'failed');
    expect(store.get(t.id)).toMatchObject({
      failureReason: 'verification-failed',
      verification: { passed: false, reason: 'tests still red' },
    });
  });

  it('fail-closes to verification-inconclusive when the verifier throws', async () => {
    const { runner } = makeRunner({ verify: async () => { throw new Error('verifier died'); } });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'failed');
    expect(store.get(t.id)?.failureReason).toBe('verification-inconclusive');
  });

  it('fails cwd-not-allowed without occupying a slot', async () => {
    const { runner } = makeRunner({ allowedRoots: ['/allowed'] });
    const t = await store.create({ goal: 'g', cwd: '/etc' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'failed');
    expect(store.get(t.id)?.failureReason).toBe('cwd-not-allowed');
    await until(() => runner.activeCount() === 0); // slot released (after the flush settles)
  });

  it('fails with a clear error when the cwd does not exist', async () => {
    const { runner } = makeRunner({ cwdExists: () => false });
    const t = await store.create({ goal: 'g', cwd: '/no/such/dir' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'failed');
    expect(store.get(t.id)).toMatchObject({ failureReason: 'error' });
    expect(store.get(t.id)?.error).toContain('working directory does not exist');
  });

  it('honors the concurrency limit', async () => {
    const defs = new Map<string, ReturnType<typeof deferred<MainOutcome>>>();
    const { runner } = makeRunner({
      concurrency: 2,
      spawnMain: (ticket) => {
        const d = deferred<MainOutcome>();
        defs.set(ticket.id, d);
        return { kill() {}, done: d.promise };
      },
    });
    const tickets = await Promise.all(
      Array.from({ length: 5 }, (_, i) => store.create({ goal: `g${i}`, cwd: '/repo' })),
    );
    tickets.forEach((t) => runner.enqueue(t));

    await until(() => defs.size === 2); // spawns happen after each slot's store write settles
    expect(runner.activeCount()).toBe(2);
    expect(defs.size).toBe(2); // only 2 spawned despite 5 queued

    // Drain: resolve whatever is currently running until all are done.
    for (let i = 0; i < 30 && !store.list().every((t) => t.state === 'done'); i++) {
      for (const [id, d] of defs) if (store.get(id)?.state === 'running') d.resolve(okOutcome());
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(store.list().every((t) => t.state === 'done')).toBe(true);
  });

  it('times out a stuck ticket and kills the process', async () => {
    const kill = vi.fn();
    const { runner } = makeRunner({
      spawnMain: () => ({ kill, done: new Promise<MainOutcome>(() => {}) }), // never resolves
      setTimer: (cb) => {
        const t = setTimeout(cb, 0);
        return () => clearTimeout(t);
      },
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'failed');
    expect(store.get(t.id)?.failureReason).toBe('timeout');
    expect(kill).toHaveBeenCalled();
  });

  it('cancels a queued ticket without ever spawning it', async () => {
    const spawned = new Set<string>();
    const held = deferred<MainOutcome>();
    const { runner } = makeRunner({
      concurrency: 1,
      spawnMain: (ticket) => {
        spawned.add(ticket.id);
        return { kill() {}, done: held.promise };
      },
    });
    const a = await store.create({ goal: 'a', cwd: '/repo' });
    const b = await store.create({ goal: 'b', cwd: '/repo' });
    runner.enqueue(a);
    runner.enqueue(b);
    await until(() => runner.activeCount() === 1);

    const cancelled = await runner.cancel(b.id);
    expect(cancelled?.failureReason).toBe('cancelled');
    expect(spawned.has(b.id)).toBe(false); // b never ran
  });

  it('recover() marks in-flight tickets interrupted and re-enqueues queued ones', async () => {
    // Simulate a pre-restart store: one running, one queued.
    const r = await store.create({ goal: 'running', cwd: '/repo' });
    await store.update(r.id, { state: 'running', startedAt: 1 });
    const q = await store.create({ goal: 'queued', cwd: '/repo' });

    const { runner } = makeRunner({
      verify: async () => ({ passed: true, reason: 'ok' }),
    });
    await runner.recover();

    expect(store.get(r.id)).toMatchObject({ state: 'failed', failureReason: 'interrupted' });
    await until(() => store.get(q.id)?.state === 'done'); // queued one gets scheduled and completes
  });
});

describe('TicketRunner onSettled hook', () => {
  it('fires once with the done ticket when a ticket completes', async () => {
    const settled: Ticket[] = [];
    const { runner } = makeRunner({
      verify: async () => ({ passed: true, reason: 'ok' }),
      onSettled: (t) => { settled.push(t); },
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => settled.length > 0);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ id: t.id, state: 'done' });
  });

  it('fires with the failed ticket when verification fails', async () => {
    const settled: Ticket[] = [];
    const { runner } = makeRunner({
      verify: async () => ({ passed: false, reason: 'nope' }),
      onSettled: (t) => { settled.push(t); },
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => settled.length > 0);
    expect(settled[0]).toMatchObject({ state: 'failed', failureReason: 'verification-failed' });
  });

  it('does not fire on non-terminal transitions (running/verifying)', async () => {
    const settledStates: string[] = [];
    const { runner } = makeRunner({
      verify: async () => ({ passed: true, reason: 'ok' }),
      onSettled: (t) => { settledStates.push(t.state); },
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => settledStates.length > 0);
    // Only the terminal state ever reaches onSettled — never 'running' or 'verifying'.
    expect(settledStates).toEqual(['done']);
  });
});

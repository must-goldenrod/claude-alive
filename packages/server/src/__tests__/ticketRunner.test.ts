import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ticket } from '@claude-alive/core';
import { createTicketStore, type TicketStore } from '../ticketStore.js';
import { createTicketRunner, isCwdAllowed, type MainOutcome, type TicketRunnerOptions } from '../ticketRunner.js';

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
});

describe('TicketRunner lifecycle', () => {
  it('drives a ticket queued → running → verifying → done', async () => {
    const { runner, broadcasts } = makeRunner({
      spawnMain: () => ({ kill() {}, done: Promise.resolve(okOutcome('did it')) }),
      verify: async () => ({ passed: true, reason: 'looks good' }),
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'done');

    const final = store.get(t.id)!;
    expect(final.result).toBe('did it');
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

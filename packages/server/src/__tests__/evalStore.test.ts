import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ticket } from '@claude-alive/core';
import { createEvalStore, type EvalStore } from '../evalStore.js';

let dir: string;
let filePath: string;

function makeStore(): EvalStore {
  let clock = 1000;
  return createEvalStore({ filePath, now: () => (clock += 10) });
}

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    seq: 1,
    goal: 'do the thing',
    cwd: '/proj/a',
    state: 'done',
    createdAt: 1,
    verification: { passed: true, reason: 'ok' },
    ...over,
  } as Ticket;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'evalstore-'));
  filePath = join(dir, 'evaluations.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createEvalStore.upsertFromTicket', () => {
  it('seeds a record from a passed ticket as good', async () => {
    const store = makeStore();
    await store.load();
    const rec = await store.upsertFromTicket(ticket());
    expect(rec.autoLabel).toBe('good');
    expect(rec.label).toBe('good');
    expect(rec.humanLabeled).toBe(false);
    expect(rec.route).toBe('/proj/a');
  });

  it('seeds a failed ticket as bad', async () => {
    const store = makeStore();
    await store.load();
    const rec = await store.upsertFromTicket(ticket({ state: 'failed', failureReason: 'timeout', verification: undefined }));
    expect(rec.autoLabel).toBe('bad');
    expect(rec.label).toBe('bad');
  });

  it('preserves a human label across re-upsert, but refreshes captured fields', async () => {
    const store = makeStore();
    await store.load();
    await store.upsertFromTicket(ticket());
    await store.setLabel('t1', { label: 'bad', weight: 5, note: 'flaky' });

    // Re-run (e.g. retry) reports a passing verdict again + new headline.
    const rec = await store.upsertFromTicket(ticket({ headline: 'fixed' }));
    expect(rec.label).toBe('bad'); // human label sticks
    expect(rec.humanLabeled).toBe(true);
    expect(rec.weight).toBe(5);
    expect(rec.note).toBe('flaky');
    expect(rec.headline).toBe('fixed'); // captured field refreshed
    expect(rec.autoLabel).toBe('good'); // auto still tracks the verdict
  });
});

describe('createEvalStore.setLabel', () => {
  it('applies label/weight/note and clamps weight', async () => {
    const store = makeStore();
    await store.load();
    await store.upsertFromTicket(ticket());
    const rec = await store.setLabel('t1', { label: 'good', weight: 99 });
    expect(rec?.weight).toBe(5);
    expect(rec?.humanLabeled).toBe(true);
  });

  it('returns undefined for an unknown ticket', async () => {
    const store = makeStore();
    await store.load();
    expect(await store.setLabel('nope', { label: 'good' })).toBeUndefined();
  });
});

describe('createEvalStore persistence + guideFor', () => {
  it('survives reload and exposes a route guide', async () => {
    const store = makeStore();
    await store.load();
    await store.upsertFromTicket(ticket({ headline: 'shipped' }));

    const reloaded = makeStore();
    await reloaded.load();
    expect(reloaded.get('t1')?.headline).toBe('shipped');

    const guide = reloaded.guideFor('/proj/a');
    expect(guide.goodCount).toBe(1);
    expect(guide.text).toContain('shipped');

    // A different route has nothing learned.
    expect(reloaded.guideFor('/proj/other').text).toBe('');
  });
});

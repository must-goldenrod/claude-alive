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
  it('survives reload and exposes a route guide once opted into the bias', async () => {
    const store = makeStore();
    await store.load();
    await store.upsertFromTicket(ticket({ headline: 'shipped' }));
    await store.setReflected('t1', true);

    const reloaded = makeStore();
    await reloaded.load();
    expect(reloaded.get('t1')?.headline).toBe('shipped');
    expect(reloaded.get('t1')?.reflected).toBe(true);

    const guide = reloaded.guideFor('/proj/a');
    expect(guide.goodCount).toBe(1);
    expect(guide.text).toContain('shipped');

    // A different route has nothing learned.
    expect(reloaded.guideFor('/proj/other').text).toBe('');
  });
});

describe('createEvalStore bias-reflection gate', () => {
  it('captures a result snapshot and completedAt from the ticket', async () => {
    const store = makeStore();
    await store.load();
    const rec = await store.upsertFromTicket(ticket({ result: '## done\nbody', endedAt: 555 }));
    expect(rec.result).toBe('## done\nbody');
    expect(rec.completedAt).toBe(555);
  });

  it('defaults reflected to false so a finished ticket does not shape the guide', async () => {
    const store = makeStore();
    await store.load();
    const rec = await store.upsertFromTicket(ticket({ headline: 'shipped' }));
    expect(rec.reflected).toBe(false);
    // Labelled good but not reflected → no injection.
    expect(store.guideFor('/proj/a').goodCount).toBe(0);
    expect(store.guideFor('/proj/a').text).toBe('');
  });

  it('setReflected toggles the gate and is preserved across re-upsert', async () => {
    const store = makeStore();
    await store.load();
    await store.upsertFromTicket(ticket({ headline: 'shipped' }));

    const on = await store.setReflected('t1', true);
    expect(on?.reflected).toBe(true);
    expect(store.guideFor('/proj/a').goodCount).toBe(1);

    // A retry re-upsert must not silently reset the human's decision.
    const reupserted = await store.upsertFromTicket(ticket({ headline: 'shipped again' }));
    expect(reupserted.reflected).toBe(true);

    const off = await store.setReflected('t1', false);
    expect(off?.reflected).toBe(false);
    expect(store.guideFor('/proj/a').goodCount).toBe(0);
  });

  it('returns undefined for an unknown ticket', async () => {
    const store = makeStore();
    await store.load();
    expect(await store.setReflected('nope', true)).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTicketStore, type TicketStore } from '../ticketStore.js';

let dir: string;
let filePath: string;

function makeStore(overrides = {}): TicketStore {
  let n = 0;
  let clock = 1000;
  return createTicketStore({
    filePath,
    now: () => (clock += 10),
    uuid: () => `id-${++n}`,
    ...overrides,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ticketstore-'));
  filePath = join(dir, 'tickets.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createTicketStore', () => {
  it('creates a queued ticket and persists it', async () => {
    const store = makeStore();
    const t = await store.create({ goal: 'do X', cwd: '/repo' });
    expect(t).toMatchObject({ id: 'id-1', goal: 'do X', cwd: '/repo', state: 'queued' });
    expect(t.createdAt).toBeGreaterThan(0);

    const onDisk = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].id).toBe('id-1');
  });

  it('reloads persisted tickets from disk', async () => {
    const a = makeStore();
    await a.create({ goal: 'g1', cwd: '/r' });
    await a.create({ goal: 'g2', cwd: '/r' });

    const b = makeStore();
    await b.load();
    expect(b.list().map((t) => t.goal)).toEqual(['g1', 'g2']);
  });

  it('update replaces immutably (old reference is untouched)', async () => {
    const store = makeStore();
    const original = await store.create({ goal: 'g', cwd: '/r' });
    const updated = await store.update(original.id, { state: 'running', startedAt: 5 });
    expect(updated).toMatchObject({ state: 'running', startedAt: 5 });
    expect(original.state).toBe('queued'); // original object not mutated
    expect(updated).not.toBe(original);
  });

  it('update returns undefined for an unknown id', async () => {
    const store = makeStore();
    expect(await store.update('nope', { state: 'done' })).toBeUndefined();
  });

  it('remove deletes and persists', async () => {
    const store = makeStore();
    const t = await store.create({ goal: 'g', cwd: '/r' });
    expect(await store.remove(t.id)).toBe(true);
    expect(store.get(t.id)).toBeUndefined();
    expect(await store.remove(t.id)).toBe(false);
  });

  it('evicts oldest terminal tickets past the cap but keeps active ones', async () => {
    const store = makeStore({ maxTickets: 2 });
    const a = await store.create({ goal: 'a', cwd: '/r' });
    const b = await store.create({ goal: 'b', cwd: '/r' });
    await store.update(a.id, { state: 'done', endedAt: 1 });
    await store.update(b.id, { state: 'done', endedAt: 2 });
    // Third create pushes over the cap of 2 → oldest terminal (a) evicted.
    const c = await store.create({ goal: 'c', cwd: '/r' });
    const ids = store.list().map((t) => t.goal).sort();
    expect(ids).toEqual(['b', 'c']);
    expect(store.get(c.id)).toBeDefined();
  });
});

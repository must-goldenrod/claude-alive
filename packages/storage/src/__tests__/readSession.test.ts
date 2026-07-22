import { beforeEach, describe, expect, test } from 'vitest';
import type { CanonicalEvent } from '@claude-alive/core';
import { openDatabase } from '../db.js';
import { runMigrations } from '../migrator.js';
import { EventStore } from '../eventStore.js';

let store: EventStore;
const ev = (sessionId: string, n: number): CanonicalEvent => ({
  schemaVersion: 2, eventId: `E-${sessionId}-${n}`, kind: 'message.user', provider: 'claude',
  source: 'hook', sourceEventId: `${sessionId}:${n}`, workspaceId: 'W', sessionId,
  occurredAt: n, receivedAt: n, confidence: 'exact', payload: { text: `m${n}` },
});

beforeEach(() => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  store = new EventStore(db);
});

describe('readSession', () => {
  test('returns only the requested session, in append order', () => {
    store.append(ev('A', 1)); store.append(ev('B', 2)); store.append(ev('A', 3));
    const { events } = store.readSession('A', 0);
    expect(events.map((e) => e.eventId)).toEqual(['E-A-1', 'E-A-3']);
  });

  test('paginates with a cursor', () => {
    for (let n = 1; n <= 5; n++) store.append(ev('A', n));
    const first = store.readSession('A', 0, 2);
    expect(first.events).toHaveLength(2);
    const next = store.readSession('A', first.cursor, 2);
    expect(next.events).toHaveLength(2);
    expect(next.events[0].eventId).not.toBe(first.events[0].eventId);
  });

  test('an unknown session yields no events rather than an error', () => {
    expect(store.readSession('nope', 0).events).toEqual([]);
  });

  test('reports whether more remain', () => {
    for (let n = 1; n <= 3; n++) store.append(ev('A', n));
    expect(store.readSession('A', 0, 2).hasMore).toBe(true);
    expect(store.readSession('A', 0, 10).hasMore).toBe(false);
  });
});

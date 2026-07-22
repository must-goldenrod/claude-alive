import { beforeEach, describe, expect, test } from 'vitest';
import type { CanonicalEvent } from '@claude-alive/core';
import { openDatabase } from '../db.js';
import { runMigrations } from '../migrator.js';
import { EventStore } from '../eventStore.js';

function ev(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    schemaVersion: 2,
    eventId: `E_${Math.random().toString(36).slice(2)}`,
    kind: 'tool.started',
    provider: 'claude',
    source: 'hook',
    workspaceId: 'W1',
    sessionId: 'S1',
    occurredAt: 1_000,
    receivedAt: 2_000,
    confidence: 'exact',
    payload: { toolName: 'Bash' },
    ...overrides,
  };
}

let store: EventStore;

beforeEach(() => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  store = new EventStore(db);
});

describe('migrations', () => {
  test('a freshly migrated store is empty', () => {
    expect(store.count()).toBe(0);
  });

  test('running migrations twice is idempotent', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(new EventStore(db).count()).toBe(0);
  });
});

describe('append + dedupe', () => {
  test('appends a new event', () => {
    const res = store.append(ev({ sourceEventId: 'tu_1:started' }));
    expect(res.inserted).toBe(true);
    expect(store.count()).toBe(1);
  });

  test('re-appending the same native event is ignored', () => {
    const e = ev({ eventId: 'E1', sourceEventId: 'tu_1:started' });
    expect(store.append(e).inserted).toBe(true);
    const again = store.append({ ...e, eventId: 'E2' }); // redelivery, new eventId
    expect(again.inserted).toBe(false);
    expect(store.count()).toBe(1);
  });

  test('different sourceEventId is a distinct event', () => {
    store.append(ev({ sourceEventId: 'tu_1:started' }));
    store.append(ev({ sourceEventId: 'tu_1:completed' }));
    expect(store.count()).toBe(2);
  });

  test('content-hash duplicates (no native id) are also ignored', () => {
    const a = ev({ eventId: 'A', kind: 'message.user', payload: { text: 'hi' } });
    const b = ev({ eventId: 'B', kind: 'message.user', payload: { text: 'hi' } });
    expect(store.append(a).inserted).toBe(true);
    expect(store.append(b).inserted).toBe(false);
    expect(store.count()).toBe(1);
  });

  test('records dedupeConfidence on the stored event', () => {
    store.append(ev({ sourceEventId: 'tu_1' }));
    store.append(ev({ kind: 'message.user', payload: { text: 'hi' } }));
    const { events } = store.readAfter(0);
    expect(events.find((e) => e.sourceEventId === 'tu_1')?.dedupeConfidence).toBe('native');
    expect(events.find((e) => e.kind === 'message.user')?.dedupeConfidence).toBe('content-hash');
  });
});

describe('readAfter', () => {
  test('round-trips event fields and returns them in append order', () => {
    store.append(ev({ eventId: 'E1', sourceEventId: 'tu_1', kind: 'tool.started', payload: { toolName: 'Bash' } }));
    store.append(ev({ eventId: 'E2', sourceEventId: 'tu_2', kind: 'tool.completed', payload: { toolName: 'Bash', response: { ok: true } }, runId: 'R1', agentId: 'A1' }));

    const { events, cursor } = store.readAfter(0);
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('tool.started');
    expect(events[1].kind).toBe('tool.completed');
    expect(events[1].payload).toEqual({ toolName: 'Bash', response: { ok: true } });
    expect(events[1].runId).toBe('R1');
    expect(events[1].agentId).toBe('A1');
    expect(events[0].sessionId).toBe('S1');
    expect(cursor).toBeGreaterThan(0);
  });

  test('advancing the cursor returns only newer events', () => {
    store.append(ev({ sourceEventId: 'tu_1' }));
    const first = store.readAfter(0);
    store.append(ev({ sourceEventId: 'tu_2' }));
    const next = store.readAfter(first.cursor);
    expect(next.events).toHaveLength(1);
    expect(next.events[0].sourceEventId).toBe('tu_2');
  });

  test('optional fields absent in the source stay absent after round-trip', () => {
    store.append(ev({ kind: 'message.user', payload: { text: 'hi' } }));
    const { events } = store.readAfter(0);
    expect(events[0].runId).toBeUndefined();
    expect(events[0].agentId).toBeUndefined();
    expect(events[0].sourceEventId).toBeUndefined();
  });
});

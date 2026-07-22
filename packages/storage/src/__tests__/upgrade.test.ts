import { describe, expect, test } from 'vitest';
import { openDatabase } from '../db.js';
import { runMigrations } from '../migrator.js';
import { MIGRATIONS } from '../schema.js';
import { EventStore } from '../eventStore.js';
import { SessionRefStore } from '../sessionRefs.js';
import type { CanonicalEvent } from '@claude-alive/core';

const ev = (o: Partial<CanonicalEvent> = {}): CanonicalEvent => ({
  schemaVersion: 2, eventId: 'E1', kind: 'session.created', provider: 'claude', source: 'hook',
  workspaceId: 'W', sessionId: 'S', occurredAt: 1, receivedAt: 2, confidence: 'exact', payload: {}, ...o,
});

describe('schema upgrade from an existing v1 database', () => {
  test('applying v2 over a populated v1 keeps the data and adds the new table', () => {
    const db = openDatabase(':memory:');
    // Simulate an older install: only migration v1 applied, with rows in it.
    runMigrations(db, MIGRATIONS.filter((m) => m.version === 1));
    const events = new EventStore(db);
    events.append(ev({ sourceEventId: 'x' }));
    expect(events.count()).toBe(1);

    // Now upgrade to the full set.
    runMigrations(db);

    expect(events.count()).toBe(1); // existing rows untouched
    const refs = new SessionRefStore(db, () => 'NEW');
    expect(refs.resolve('claude', 'c1')).toBe('NEW');
  });

  test('re-running the full migration set on an up-to-date database is a no-op', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const refs = new SessionRefStore(db, () => 'A');
    refs.resolve('claude', 'c1');
    expect(() => runMigrations(db)).not.toThrow();
    expect(refs.count()).toBe(1);
  });
});

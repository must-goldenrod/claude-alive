import { describe, expect, test } from 'vitest';
import type { CanonicalEvent } from '@claude-alive/core';
import { computeDedupeKey } from '../dedupe.js';

function ev(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    schemaVersion: 2,
    eventId: 'E1',
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

describe('computeDedupeKey — native id', () => {
  test('uses the source event id and marks confidence native', () => {
    const { key, confidence } = computeDedupeKey(ev({ sourceEventId: 'tu_1:started' }));
    expect(confidence).toBe('native');
    expect(key).toContain('tu_1:started');
  });

  test('same provider/session/sourceEventId yields the same key across redeliveries', () => {
    const a = computeDedupeKey(ev({ eventId: 'E1', sourceEventId: 'tu_1', receivedAt: 10 }));
    const b = computeDedupeKey(ev({ eventId: 'E2', sourceEventId: 'tu_1', receivedAt: 99 }));
    expect(a.key).toBe(b.key);
  });

  test('different sourceEventId yields different keys', () => {
    const a = computeDedupeKey(ev({ sourceEventId: 'tu_1' }));
    const b = computeDedupeKey(ev({ sourceEventId: 'tu_2' }));
    expect(a.key).not.toBe(b.key);
  });

  test('same sourceEventId in different sessions does not collide', () => {
    const a = computeDedupeKey(ev({ sessionId: 'S1', sourceEventId: 'tu_1' }));
    const b = computeDedupeKey(ev({ sessionId: 'S2', sourceEventId: 'tu_1' }));
    expect(a.key).not.toBe(b.key);
  });
});

describe('computeDedupeKey — content-hash fallback', () => {
  test('falls back to content hash and marks confidence content-hash', () => {
    const { key, confidence } = computeDedupeKey(ev({ kind: 'message.user', payload: { text: 'hi' } }));
    expect(confidence).toBe('content-hash');
    expect(key.length).toBeGreaterThan(0);
  });

  test('identical content dedupes even when eventId differs', () => {
    const a = computeDedupeKey(ev({ eventId: 'E1', kind: 'message.user', payload: { text: 'hi' } }));
    const b = computeDedupeKey(ev({ eventId: 'E2', kind: 'message.user', payload: { text: 'hi' } }));
    expect(a.key).toBe(b.key);
  });

  test('different payload content produces different keys', () => {
    const a = computeDedupeKey(ev({ kind: 'message.user', payload: { text: 'hi' } }));
    const b = computeDedupeKey(ev({ kind: 'message.user', payload: { text: 'bye' } }));
    expect(a.key).not.toBe(b.key);
  });

  test('different occurredAt (time window) separates otherwise-identical events', () => {
    const a = computeDedupeKey(ev({ kind: 'message.user', payload: { text: 'hi' }, occurredAt: 1_000 }));
    const b = computeDedupeKey(ev({ kind: 'message.user', payload: { text: 'hi' }, occurredAt: 5_000 }));
    expect(a.key).not.toBe(b.key);
  });

  test('payload key ordering does not affect the hash', () => {
    const a = computeDedupeKey(ev({ kind: 'tool.completed', payload: { a: 1, b: 2 }, sourceEventId: undefined }));
    const b = computeDedupeKey(ev({ kind: 'tool.completed', payload: { b: 2, a: 1 }, sourceEventId: undefined }));
    expect(a.key).toBe(b.key);
  });
});

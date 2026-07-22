/**
 * Dedupe key derivation (spec §I.4).
 *
 * When an event carries a provider-native id we key on
 * `(provider, sessionId, sourceEventId)` — a re-delivered event dedupes exactly.
 * When it does not, we fall back to a content hash over the event's stable fields
 * (provider, session, kind, occurredAt, payload); `occurredAt` acts as the time
 * window so identical content at different times is not treated as a duplicate.
 *
 * The content-hash path is best-effort by construction — this is the spec's
 * acknowledged §I.4 tradeoff, which is exactly why the derived key is tagged
 * `content-hash` (vs `native`) so consumers can treat these dedupes as heuristic:
 *   - False positive: two genuinely distinct events with identical
 *     (provider, session, kind, occurredAt, payload) collapse to one. Losing a
 *     byte-identical duplicate is the chosen tradeoff vs. dropping native events.
 *   - False negative: an event that has neither a native id nor a trustworthy
 *     timestamp (so `occurredAt` was filled from `receivedAt` upstream) hashes
 *     differently on each redelivery and is not deduped. Duplicate accumulation
 *     is preferred over silent loss; the `content-hash` tag flags the low trust.
 * Events with a native id (`sourceEventId`) are not subject to either.
 */

import { createHash } from 'node:crypto';
import type { CanonicalEvent, DedupeConfidence } from '@claude-alive/core';

export interface DedupeKey {
  key: string;
  confidence: DedupeConfidence;
}

/** Deterministic JSON with recursively sorted object keys. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function computeDedupeKey(event: CanonicalEvent): DedupeKey {
  if (event.sourceEventId) {
    return {
      key: `native:${event.provider}:${event.sessionId}:${event.sourceEventId}`,
      confidence: 'native',
    };
  }
  const material = stableStringify({
    provider: event.provider,
    sessionId: event.sessionId,
    kind: event.kind,
    occurredAt: event.occurredAt,
    payload: event.payload,
  });
  const hash = createHash('sha256').update(material).digest('hex');
  return { key: `hash:${hash}`, confidence: 'content-hash' };
}

/**
 * Append-only canonical event store (spec §G.4, §I.4, §K.2).
 *
 * `append` is dedupe-aware: it derives the event's dedupe key, records the
 * derivation confidence, and relies on a UNIQUE constraint so a re-delivered
 * event is silently ignored. `readAfter` is the projection feed — events are read
 * in append order past a cursor, so projections can be rebuilt or resumed.
 */

import type { CanonicalEvent, CanonicalEventKind, EventSource, ProviderId } from '@claude-alive/core';
import type { Database } from './db.js';
import { computeDedupeKey } from './dedupe.js';

interface EventRow {
  id: number;
  event_id: string;
  dedupe_confidence: string;
  schema_version: number;
  kind: string;
  provider: string;
  source: string;
  source_event_id: string | null;
  workspace_id: string;
  session_id: string;
  run_id: string | null;
  agent_id: string | null;
  seq: number | null;
  occurred_at: number;
  received_at: number;
  confidence: string;
  payload: string;
  raw_ref: string | null;
}

export interface SessionReadResult extends ReadResult {
  /** True when more events exist past `cursor` for this session. */
  hasMore: boolean;
}

export interface ReadResult {
  events: CanonicalEvent[];
  /** Highest `id` returned; pass back to `readAfter` to resume. */
  cursor: number;
}

const INSERT_SQL = `
  INSERT OR IGNORE INTO events (
    event_id, dedupe_key, dedupe_confidence, schema_version, kind, provider, source,
    source_event_id, workspace_id, session_id, run_id, agent_id, seq,
    occurred_at, received_at, confidence, payload, raw_ref
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

function rowToEvent(row: EventRow): CanonicalEvent {
  const event: CanonicalEvent = {
    // Read the stored version rather than hardcoding, so a future schema bump is
    // labelled with the version the row was actually written under.
    schemaVersion: row.schema_version as CanonicalEvent['schemaVersion'],
    eventId: row.event_id,
    kind: row.kind as CanonicalEventKind,
    provider: row.provider as ProviderId,
    source: row.source as EventSource,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    confidence: row.confidence as CanonicalEvent['confidence'],
    dedupeConfidence: row.dedupe_confidence as CanonicalEvent['dedupeConfidence'],
    payload: JSON.parse(row.payload),
  };
  if (row.source_event_id !== null) event.sourceEventId = row.source_event_id;
  if (row.run_id !== null) event.runId = row.run_id;
  if (row.agent_id !== null) event.agentId = row.agent_id;
  if (row.seq !== null) event.seq = row.seq;
  if (row.raw_ref !== null) event.rawRef = row.raw_ref;
  return event;
}

export class EventStore {
  constructor(private readonly db: Database) {}

  /** Append an event; returns whether it was newly inserted (false = duplicate). */
  append(event: CanonicalEvent): { inserted: boolean; dedupeConfidence: CanonicalEvent['dedupeConfidence'] } {
    const { key, confidence } = computeDedupeKey(event);
    const result = this.db
      .prepare(INSERT_SQL)
      .run(
        event.eventId,
        key,
        confidence,
        event.schemaVersion,
        event.kind,
        event.provider,
        event.source,
        orNull(event.sourceEventId),
        event.workspaceId,
        event.sessionId,
        orNull(event.runId),
        orNull(event.agentId),
        orNull(event.seq),
        event.occurredAt,
        event.receivedAt,
        event.confidence,
        JSON.stringify(event.payload),
        orNull(event.rawRef),
      );
    return { inserted: Number(result.changes) > 0, dedupeConfidence: confidence };
  }

  /**
   * Read events appended after `cursor` (an `id`), in append order.
   *
   * Append order is the canonical replay order for projection rebuild (§K.2).
   * It is NOT re-sorted by `occurredAt`/`seq`: when a provider's logical order
   * differs from arrival order, correcting it is the projection layer's job, not
   * the log's — the log records what arrived, when it arrived.
   */
  readAfter(cursor: number, limit = 1000): ReadResult {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?')
      .all(cursor, limit) as unknown as (EventRow & { id: number })[];
    const events = rows.map(rowToEvent);
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : cursor;
    return { events, cursor: nextCursor };
  }

  /**
   * Read one session's events past `cursor`, in append order. Used by the
   * conversation reader, which must not scan the whole log to render one session.
   */
  readSession(sessionId: string, cursor: number, limit = 500): SessionReadResult {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
      .all(sessionId, cursor, limit + 1) as unknown as (EventRow & { id: number })[];
    // One extra row is fetched purely to answer "is there more" without a count.
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      events: page.map(rowToEvent),
      cursor: page.length > 0 ? page[page.length - 1].id : cursor,
      hasMore,
    };
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number };
    return row.c;
  }
}

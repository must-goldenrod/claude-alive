/**
 * Canonical event envelope (spec §I.3).
 *
 * Every provider event — a Claude hook, a Codex app-server notification, a Hermes
 * gateway message, or a PTY-derived synthetic — is normalized into this envelope
 * before it is persisted. The envelope carries provenance (`source`, `confidence`,
 * `rawRef`) so downstream consumers can weigh structured data against inference.
 */

import type { ProviderId } from './capabilities.js';
import type { StateConfidence } from './state.js';

export const CANONICAL_EVENT_KINDS = [
  'session.created',
  'session.updated',
  'session.ended',
  'run.started',
  'run.completed',
  'run.failed',
  'agent.spawned',
  'agent.state',
  'agent.despawned',
  'message.user',
  'message.assistant',
  'message.reasoning',
  'message.delta',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
  'approval.requested',
  'approval.decided',
  'usage.updated',
  'artifact.created',
  'result.ready',
  'connection.online',
  'connection.degraded',
  'connection.offline',
] as const;

export type CanonicalEventKind = (typeof CANONICAL_EVENT_KINDS)[number];

/** Where the normalized event came from — used to weigh trust and dedupe. */
export type EventSource = 'structured' | 'hook' | 'transcript' | 'pty' | 'synthetic';

export interface CanonicalEvent<T = unknown> {
  schemaVersion: 2;
  eventId: string;
  kind: CanonicalEventKind;
  provider: ProviderId;
  source: EventSource;
  /** Provider-native event id, when one exists (used for dedupe). */
  sourceEventId?: string;
  workspaceId: string;
  sessionId: string;
  runId?: string;
  agentId?: string;
  /** Per-session monotonically increasing sequence, when the source provides one. */
  seq?: number;
  occurredAt: number;
  receivedAt: number;
  confidence: StateConfidence;
  payload: T;
  /** Opaque reference to the stored raw event (e.g. a transcript offset or row id). */
  rawRef?: string;
}

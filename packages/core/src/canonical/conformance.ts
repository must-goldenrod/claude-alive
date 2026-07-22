/**
 * Adapter conformance harness (spec §R.1).
 *
 * Drives any `AgentRuntimeAdapter` through detect → capabilities → health →
 * start → send → attach → close, then validates the emitted canonical event
 * stream against the provider-neutral invariants every adapter must satisfy.
 * Fixture-driven adapters (recorded protocol) make this deterministic with no
 * real CLI installed.
 *
 * Coverage maps to the §R.1 checklist: detect/health, start→streaming→complete,
 * tool start/complete/failure pairing, approval request/decision pairing,
 * duplicate/out-of-order events, token finalization, unsupported capability, and
 * capability↔method presence. Interactive round-trip driving of interrupt/approve
 * (send → observe the reaction) is a deeper tier layered on interactive fixtures;
 * this tier validates the recorded stream and the declared/implemented surface.
 */

import type { AgentRuntimeAdapter, StartSessionInput } from './adapter.js';
import type { CanonicalEvent, CanonicalEventKind } from './events.js';
import type { ProviderCapabilities } from './capabilities.js';

export interface ConformanceCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface ConformanceReport {
  passed: boolean;
  checks: ConformanceCheck[];
}

export interface ConformanceOptions {
  start: StartSessionInput;
  /** Safety cap so a misbehaving adapter cannot stream forever. */
  maxEvents?: number;
}

const LIFECYCLE_OPENING: ReadonlySet<CanonicalEventKind> = new Set(['session.created', 'run.started']);

const TERMINAL: ReadonlySet<CanonicalEventKind> = new Set(['run.completed', 'run.failed', 'session.ended']);

const CONTENT: ReadonlySet<CanonicalEventKind> = new Set([
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
  'agent.spawned',
  'agent.state',
  'agent.despawned',
]);

const REQUIRED_CAPABILITY_KEYS: readonly (keyof ProviderCapabilities)[] = [
  'structuredEvents',
  'streamingMessages',
  'toolLifecycle',
  'approvals',
  'tokenUsage',
  'subagents',
  'resume',
  'interrupt',
  'steer',
  'mcpInventory',
  'artifacts',
];

function pass(name: string): ConformanceCheck {
  return { name, passed: true };
}
function fail(name: string, detail: string): ConformanceCheck {
  return { name, passed: false, detail };
}

function payloadString(event: CanonicalEvent, key: string): string | undefined {
  const p = event.payload as Record<string, unknown>;
  return typeof p?.[key] === 'string' ? (p[key] as string) : undefined;
}

// ── stream invariants ────────────────────────────────────────────────────────

function checkEnvelope(events: CanonicalEvent[], provider: string): ConformanceCheck {
  for (const e of events) {
    if (e.schemaVersion !== 2) return fail('envelope', `event ${e.eventId} has schemaVersion ${e.schemaVersion}`);
    if (e.provider !== provider) return fail('envelope', `event ${e.eventId} provider ${e.provider} ≠ adapter ${provider}`);
    if (!e.sessionId) return fail('envelope', `event ${e.eventId} has no sessionId`);
    if (!Number.isFinite(e.occurredAt)) return fail('envelope', `event ${e.eventId} occurredAt is not finite`);
    if (!Number.isFinite(e.receivedAt)) return fail('envelope', `event ${e.eventId} receivedAt is not finite`);
  }
  return pass('envelope');
}

function checkEventUniqueness(events: CanonicalEvent[]): ConformanceCheck {
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.eventId)) return fail('event-uniqueness', `duplicate eventId ${e.eventId}`);
    seen.add(e.eventId);
  }
  return pass('event-uniqueness');
}

function checkSeqMonotonic(events: CanonicalEvent[]): ConformanceCheck {
  let last = -Infinity;
  for (const e of events) {
    if (e.seq === undefined) continue;
    if (e.seq < last) return fail('seq-monotonic', `seq ${e.seq} on ${e.eventId} decreased from ${last}`);
    last = e.seq;
  }
  return pass('seq-monotonic');
}

function checkLifecycleOrdering(events: CanonicalEvent[]): ConformanceCheck {
  let opened = false;
  for (const e of events) {
    if (LIFECYCLE_OPENING.has(e.kind)) opened = true;
    else if (CONTENT.has(e.kind) && !opened) {
      return fail('lifecycle-ordering', `content event ${e.kind} (${e.eventId}) preceded any lifecycle-opening event`);
    }
  }
  return pass('lifecycle-ordering');
}

function checkTerminal(events: CanonicalEvent[], truncated: boolean): ConformanceCheck {
  if (events.some((e) => TERMINAL.has(e.kind))) return pass('terminal-event');
  return fail(
    'terminal-event',
    truncated
      ? 'stream was truncated at the event cap before any terminal event'
      : 'stream contained no run.completed / run.failed / session.ended',
  );
}

function checkToolPairing(events: CanonicalEvent[]): ConformanceCheck {
  const open = new Set<string>();
  for (const e of events) {
    if (e.kind === 'tool.started') {
      const id = payloadString(e, 'toolUseId');
      if (id) open.add(id);
    } else if (e.kind === 'tool.completed' || e.kind === 'tool.failed') {
      const id = payloadString(e, 'toolUseId');
      if (!id) return fail('tool-pairing', `${e.kind} (${e.eventId}) has no toolUseId to correlate`);
      if (!open.has(id)) return fail('tool-pairing', `${e.kind} for ${id} had no open tool.started`);
      open.delete(id); // consume: one completion per start
    }
  }
  return pass('tool-pairing');
}

function checkApprovalPairing(events: CanonicalEvent[]): ConformanceCheck {
  const pending = new Set<string>();
  for (const e of events) {
    const id = payloadString(e, 'approvalId');
    if (e.kind === 'approval.requested') {
      if (!id) return fail('approval-pairing', `approval.requested (${e.eventId}) has no approvalId`);
      pending.add(id);
    } else if (e.kind === 'approval.decided' && id) {
      pending.delete(id);
    }
  }
  if (pending.size > 0) return fail('approval-pairing', `unanswered approval requests: ${[...pending].join(', ')}`);
  return pass('approval-pairing');
}

function checkTokenFinalization(events: CanonicalEvent[]): ConformanceCheck {
  const terminalIdx = events.findIndex((e) => TERMINAL.has(e.kind));
  if (terminalIdx < 0) return pass('token-finalization'); // terminal absence handled elsewhere
  const late = events.slice(terminalIdx + 1).find((e) => e.kind === 'usage.updated');
  return late
    ? fail('token-finalization', `usage.updated (${late.eventId}) emitted after the terminal event`)
    : pass('token-finalization');
}

function checkCapabilityConsistency(events: CanonicalEvent[], caps: ProviderCapabilities): ConformanceCheck {
  if (caps.approvals === 'none' && events.some((e) => e.kind.startsWith('approval.'))) {
    return fail('capability-consistency', 'emitted approval.* but declared approvals: none');
  }
  if (caps.tokenUsage === 'none' && events.some((e) => e.kind === 'usage.updated')) {
    return fail('capability-consistency', 'emitted usage.updated but declared tokenUsage: none');
  }
  if (caps.toolLifecycle === false && events.some((e) => e.kind.startsWith('tool.'))) {
    return fail('capability-consistency', 'emitted tool.* but declared toolLifecycle: false');
  }
  if (caps.subagents === 'none' && events.some((e) => e.kind === 'agent.spawned')) {
    return fail('capability-consistency', 'emitted agent.spawned but declared subagents: none');
  }
  return pass('capability-consistency');
}

function checkCapabilityMethods(adapter: AgentRuntimeAdapter, caps: ProviderCapabilities): ConformanceCheck {
  const missing: string[] = [];
  if (caps.interrupt && typeof adapter.interrupt !== 'function') missing.push('interrupt');
  if (caps.approvals === 'native' && typeof adapter.approve !== 'function') missing.push('approve');
  if (caps.resume !== 'none' && typeof adapter.resume !== 'function') missing.push('resume');
  return missing.length === 0
    ? pass('capability-methods')
    : fail('capability-methods', `declared capabilities without methods: ${missing.join(', ')}`);
}

// ── driver ───────────────────────────────────────────────────────────────────

export async function runConformanceSuite(
  adapter: AgentRuntimeAdapter,
  options: ConformanceOptions,
): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = [];

  const installation = await adapter.detect();
  checks.push(
    typeof installation?.installed === 'boolean' ? pass('detect') : fail('detect', 'detect() did not return an installed boolean'),
  );

  const caps = await adapter.capabilities();
  const missing = REQUIRED_CAPABILITY_KEYS.filter((k) => caps?.[k] === undefined);
  checks.push(missing.length === 0 ? pass('capabilities') : fail('capabilities', `missing capability keys: ${missing.join(', ')}`));
  checks.push(checkCapabilityMethods(adapter, caps));

  const health = await adapter.health();
  checks.push(
    health && ['ok', 'degraded', 'down'].includes(health.status) ? pass('health') : fail('health', 'health() returned an invalid status'),
  );

  const handle = await adapter.start(options.start);
  checks.push(handle?.sessionId === options.start.sessionId ? pass('start') : fail('start', 'start() did not echo the requested sessionId'));

  try {
    await adapter.send(options.start.sessionId, { text: options.start.prompt ?? '' });
    checks.push(pass('send'));
  } catch (error) {
    checks.push(fail('send', `send() threw: ${error instanceof Error ? error.message : String(error)}`));
  }

  const events: CanonicalEvent[] = [];
  const cap = options.maxEvents ?? 10_000;
  let truncated = false;
  let attachFailed = false;
  try {
    for await (const e of adapter.attach({ sessionId: options.start.sessionId, providerSessionId: handle?.providerSessionId })) {
      events.push(e);
      if (events.length >= cap) {
        truncated = true;
        break;
      }
    }
    checks.push(pass('attach'));
  } catch (error) {
    attachFailed = true;
    checks.push(fail('attach', `attach() threw: ${error instanceof Error ? error.message : String(error)}`));
  }
  await adapter.close(options.start.sessionId);

  if (!attachFailed) {
    checks.push(checkEnvelope(events, adapter.provider));
    checks.push(checkEventUniqueness(events));
    checks.push(checkSeqMonotonic(events));
    checks.push(checkLifecycleOrdering(events));
    checks.push(checkTerminal(events, truncated));
    checks.push(checkToolPairing(events));
    checks.push(checkApprovalPairing(events));
    checks.push(checkTokenFinalization(events));
    checks.push(checkCapabilityConsistency(events, caps));
  }

  return { passed: checks.every((c) => c.passed), checks };
}

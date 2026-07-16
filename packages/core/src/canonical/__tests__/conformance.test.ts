import { describe, expect, test } from 'vitest';
import { runConformanceSuite } from '../conformance.js';
import type {
  AgentRuntimeAdapter,
  RuntimeInstallation,
  AdapterHealth,
  StartSessionInput,
  ProviderSessionRef,
  ApprovalDecision,
  SessionId,
  UserInput,
} from '../adapter.js';
import type { CanonicalEvent, CanonicalEventKind } from '../events.js';
import type { ProviderCapabilities, ProviderId } from '../capabilities.js';

const CAPS: ProviderCapabilities = {
  structuredEvents: true,
  streamingMessages: true,
  toolLifecycle: true,
  approvals: 'native',
  tokenUsage: 'live',
  subagents: 'partial',
  resume: 'stable-id',
  interrupt: true,
  steer: false,
  mcpInventory: false,
  artifacts: true,
};

let seq = 0;
function evt(kind: CanonicalEventKind, extra: Partial<CanonicalEvent> = {}): CanonicalEvent {
  seq++;
  return {
    schemaVersion: 2,
    eventId: `E${seq}`,
    kind,
    provider: 'claude',
    source: 'structured',
    workspaceId: 'W1',
    sessionId: 'S1',
    occurredAt: 1000 + seq,
    receivedAt: 2000 + seq,
    confidence: 'exact',
    payload: {},
    ...extra,
  };
}

type OptionalMethod = 'interrupt' | 'approve' | 'resume';

interface Fixture {
  provider?: ProviderId;
  installation?: RuntimeInstallation;
  capabilities?: ProviderCapabilities;
  health?: AdapterHealth;
  events: CanonicalEvent[];
  /** Optional methods to leave unimplemented (to simulate capability/method mismatch). */
  omit?: OptionalMethod[];
  /** Make attach throw, to exercise the disconnect path. */
  attachThrows?: boolean;
}

class MockReplayAdapter implements AgentRuntimeAdapter {
  readonly provider: ProviderId;
  interrupt?: (sessionId: SessionId) => Promise<void>;
  approve?: (request: ApprovalDecision) => Promise<void>;
  resume?: (ref: ProviderSessionRef) => Promise<{ sessionId: SessionId }>;

  constructor(private readonly fx: Fixture) {
    this.provider = fx.provider ?? 'claude';
    const omit = new Set(fx.omit ?? []);
    if (!omit.has('interrupt')) this.interrupt = async () => {};
    if (!omit.has('approve')) this.approve = async () => {};
    if (!omit.has('resume')) this.resume = async (ref) => ({ sessionId: ref.sessionId });
  }
  async detect(): Promise<RuntimeInstallation> {
    return this.fx.installation ?? { installed: true, version: '1.0.0' };
  }
  async capabilities(): Promise<ProviderCapabilities> {
    return this.fx.capabilities ?? CAPS;
  }
  async health(): Promise<AdapterHealth> {
    return this.fx.health ?? { status: 'ok' };
  }
  async start(input: StartSessionInput) {
    return { sessionId: input.sessionId };
  }
  async *attach(_ref: ProviderSessionRef): AsyncIterable<CanonicalEvent> {
    if (this.fx.attachThrows) throw new Error('disconnected');
    for (const e of this.fx.events) yield e;
  }
  async send(_sessionId: SessionId, _input: UserInput): Promise<void> {}
  async close(): Promise<void> {}
}

const START: StartSessionInput = { sessionId: 'S1', workspaceId: 'W1', cwd: '/repo', prompt: 'go' };

function goodEvents(): CanonicalEvent[] {
  seq = 0;
  return [
    evt('session.created'),
    evt('message.user', { payload: { text: 'do it' } }),
    evt('tool.started', { payload: { toolName: 'Bash', toolUseId: 'tu1' } }),
    evt('tool.completed', { payload: { toolName: 'Bash', toolUseId: 'tu1' } }),
    evt('usage.updated', { payload: { totalTokens: 10 } }),
    evt('message.assistant', { payload: { text: 'done' } }),
    evt('run.completed'),
  ];
}

function check(report: { checks: { name: string; passed: boolean }[] }, name: string): boolean {
  const c = report.checks.find((x) => x.name === name);
  if (!c) throw new Error(`check "${name}" not present in report`);
  return c.passed;
}

async function run(fx: Fixture) {
  return runConformanceSuite(new MockReplayAdapter(fx), { start: START });
}

describe('runConformanceSuite — well-formed adapter', () => {
  test('passes every check', async () => {
    const report = await run({ events: goodEvents() });
    for (const c of report.checks) expect({ name: c.name, passed: c.passed }).toEqual({ name: c.name, passed: true });
    expect(report.passed).toBe(true);
  });
});

describe('envelope', () => {
  test('flags a provider mismatch', async () => {
    const events = goodEvents();
    events[1] = { ...events[1], provider: 'codex' };
    expect(check(await run({ events }), 'envelope')).toBe(false);
  });

  test('flags a NaN occurredAt', async () => {
    const events = goodEvents();
    events[1] = { ...events[1], occurredAt: NaN };
    expect(check(await run({ events }), 'envelope')).toBe(false);
  });

  test('flags a non-finite receivedAt', async () => {
    const events = goodEvents();
    events[1] = { ...events[1], receivedAt: Number.POSITIVE_INFINITY };
    expect(check(await run({ events }), 'envelope')).toBe(false);
  });
});

describe('lifecycle ordering', () => {
  test('flags a content event before any lifecycle-opening event', async () => {
    seq = 0;
    const events = [evt('message.user', { payload: { text: 'early' } }), evt('session.created'), evt('run.completed')];
    expect(check(await run({ events }), 'lifecycle-ordering')).toBe(false);
  });

  test('a subagent spawn does not count as the root session opening', async () => {
    seq = 0;
    const events = [
      evt('agent.spawned', { agentId: 'a1' }),
      evt('message.assistant', { payload: { text: 'hi' } }),
      evt('run.completed'),
    ];
    expect(check(await run({ events }), 'lifecycle-ordering')).toBe(false);
  });

  test('flags a stream with no terminal event', async () => {
    seq = 0;
    const events = [evt('session.created'), evt('message.user', { payload: { text: 'hi' } })];
    expect(check(await run({ events }), 'terminal-event')).toBe(false);
  });
});

describe('tool lifecycle', () => {
  test('flags tool.completed without a matching tool.started', async () => {
    seq = 0;
    const events = [
      evt('session.created'),
      evt('tool.completed', { payload: { toolName: 'Bash', toolUseId: 'orphan' } }),
      evt('run.completed'),
    ];
    expect(check(await run({ events }), 'tool-pairing')).toBe(false);
  });

  test('flags a tool.completed with no toolUseId at all', async () => {
    seq = 0;
    const events = [evt('session.created'), evt('tool.completed', { payload: { toolName: 'Bash' } }), evt('run.completed')];
    expect(check(await run({ events }), 'tool-pairing')).toBe(false);
  });

  test('flags a second completion for the same tool_use_id (cardinality)', async () => {
    seq = 0;
    const events = [
      evt('session.created'),
      evt('tool.started', { payload: { toolName: 'Bash', toolUseId: 'tu1' } }),
      evt('tool.completed', { payload: { toolName: 'Bash', toolUseId: 'tu1' } }),
      evt('tool.completed', { payload: { toolName: 'Bash', toolUseId: 'tu1' } }),
      evt('run.completed'),
    ];
    expect(check(await run({ events }), 'tool-pairing')).toBe(false);
  });
});

describe('approvals', () => {
  test('flags approval.requested with no following approval.decided', async () => {
    seq = 0;
    const events = [
      evt('session.created'),
      evt('approval.requested', { payload: { approvalId: 'ap1', toolName: 'Bash' } }),
      evt('run.completed'),
    ];
    expect(check(await run({ events }), 'approval-pairing')).toBe(false);
  });

  test('passes when the request is answered', async () => {
    seq = 0;
    const events = [
      evt('session.created'),
      evt('approval.requested', { payload: { approvalId: 'ap1', toolName: 'Bash' } }),
      evt('approval.decided', { payload: { approvalId: 'ap1', decision: 'allow' } }),
      evt('run.completed'),
    ];
    expect(check(await run({ events }), 'approval-pairing')).toBe(true);
  });

  test('flags approval events when the adapter declares approvals: none', async () => {
    seq = 0;
    const events = [
      evt('session.created'),
      evt('approval.requested', { payload: { approvalId: 'ap1' } }),
      evt('approval.decided', { payload: { approvalId: 'ap1', decision: 'allow' } }),
      evt('run.completed'),
    ];
    const report = await run({ events, capabilities: { ...CAPS, approvals: 'none' } });
    expect(check(report, 'capability-consistency')).toBe(false);
  });
});

describe('duplicate / out-of-order', () => {
  test('flags a duplicate eventId', async () => {
    seq = 0;
    const events = [evt('session.created'), evt('message.user', { eventId: 'DUP', payload: { text: 'a' } }), evt('message.assistant', { eventId: 'DUP', payload: { text: 'b' } }), evt('run.completed')];
    expect(check(await run({ events }), 'event-uniqueness')).toBe(false);
  });

  test('flags a decreasing seq', async () => {
    seq = 0;
    const events = [
      evt('session.created', { seq: 1 }),
      evt('message.user', { seq: 5, payload: { text: 'a' } }),
      evt('message.assistant', { seq: 3, payload: { text: 'b' } }),
      evt('run.completed', { seq: 6 }),
    ];
    expect(check(await run({ events }), 'seq-monotonic')).toBe(false);
  });
});

describe('token finalization', () => {
  test('flags usage.updated emitted after the terminal event', async () => {
    seq = 0;
    const events = [
      evt('session.created'),
      evt('run.completed'),
      evt('usage.updated', { payload: { totalTokens: 10 } }),
    ];
    expect(check(await run({ events }), 'token-finalization')).toBe(false);
  });
});

describe('capability ↔ method presence', () => {
  test('flags interrupt:true with no interrupt() method', async () => {
    expect(check(await run({ events: goodEvents(), omit: ['interrupt'] }), 'capability-methods')).toBe(false);
  });

  test('flags approvals:native with no approve() method', async () => {
    expect(check(await run({ events: goodEvents(), omit: ['approve'] }), 'capability-methods')).toBe(false);
  });

  test('flags resume:stable-id with no resume() method', async () => {
    expect(check(await run({ events: goodEvents(), omit: ['resume'] }), 'capability-methods')).toBe(false);
  });
});

describe('disconnect resilience', () => {
  test('a throwing attach becomes a failed check, not a rejected suite', async () => {
    const report = await run({ events: [], attachThrows: true });
    expect(check(report, 'attach')).toBe(false);
    expect(report.passed).toBe(false);
  });
});

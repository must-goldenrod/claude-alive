import { describe, expect, test } from 'vitest';
import { createCodexAdapter, CODEX_CAPABILITIES } from '../codexAdapter.js';
import { runConformanceSuite } from '../conformance.js';
import type { CodexServerMessage } from '../codexToCanonical.js';

/**
 * A recorded turn as the app-server reports it (§R.1 recorded protocol fixture).
 * This is the shape the adapter must survive without a Codex install.
 */
const RECORDED_TURN: CodexServerMessage[] = [
  { method: 'thread/started', params: { threadId: 'th_1', cwd: '/repo/alpha' } },
  { method: 'turn/started', params: { turnId: 't_1' } },
  { method: 'item/started', params: { item: { id: 'i1', type: 'commandExecution', command: 'pnpm test' } } },
  { method: 'item/completed', params: { item: { id: 'i1', type: 'commandExecution', exitCode: 0 } } },
  { method: 'thread/tokenUsage/updated', params: { usage: { inputTokens: 120, outputTokens: 30 } } },
  { method: 'item/completed', params: { item: { id: 'i2', type: 'agentMessage', text: 'tests pass' } } },
  { method: 'turn/completed', params: { turnId: 't_1' } },
];

const START = { sessionId: 'S1', workspaceId: 'W1', cwd: '/repo/alpha', prompt: 'run the tests' };

describe('capabilities', () => {
  test('declares a structured, approval-capable provider', () => {
    expect(CODEX_CAPABILITIES).toMatchObject({
      structuredEvents: true,
      toolLifecycle: true,
      approvals: 'native',
      tokenUsage: 'live',
      interrupt: true,
    });
  });
});

describe('conformance against a recorded turn', () => {
  test('passes every check in the harness', async () => {
    const adapter = createCodexAdapter({
      messages: RECORDED_TURN,
      installation: { installed: true, version: '0.144.5' },
    });
    const report = await runConformanceSuite(adapter, { start: START });
    for (const c of report.checks) {
      expect({ name: c.name, passed: c.passed, detail: c.detail }).toEqual({
        name: c.name,
        passed: true,
        detail: undefined,
      });
    }
    expect(report.passed).toBe(true);
  });

  test('reports not-installed without throwing when the binary is absent', async () => {
    const adapter = createCodexAdapter({
      messages: [],
      installation: { installed: false, detail: 'spawn codex ENOENT' },
    });
    expect(await adapter.detect()).toMatchObject({ installed: false });
    expect((await adapter.health()).status).toBe('down');
  });
});

describe('event stream', () => {
  test('emits canonical events for the recorded turn', async () => {
    const adapter = createCodexAdapter({ messages: RECORDED_TURN });
    await adapter.start(START);
    const kinds: string[] = [];
    for await (const e of adapter.attach({ sessionId: 'S1' })) kinds.push(e.kind);
    expect(kinds).toEqual([
      'session.created',
      'run.started',
      'tool.started',
      'tool.completed',
      'usage.updated',
      'message.assistant',
      'run.completed',
    ]);
  });

  test('every emitted event is attributed to codex', async () => {
    const adapter = createCodexAdapter({ messages: RECORDED_TURN });
    await adapter.start(START);
    for await (const e of adapter.attach({ sessionId: 'S1' })) {
      expect(e.provider).toBe('codex');
      expect(e.sessionId).toBe('S1');
    }
  });
});

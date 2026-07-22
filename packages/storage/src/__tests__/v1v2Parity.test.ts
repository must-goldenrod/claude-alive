/**
 * P0 exit gate: "같은 이벤트로 v1/v2 Projection 결과가 일치한다."
 *
 * Feeds one hook sequence through both pipelines and compares the facts they
 * both claim to know:
 *   v1: HookEventPayload → SessionStore (legacy FSM)
 *   v2: HookEventPayload → claudeHookToCanonical → EventStore → buildProjection
 *
 * Lives in the storage package because the v2 path must go through real
 * persistence (append + dedupe + read back), not just an in-memory array.
 */

import { describe, expect, test } from 'vitest';
import {
  SessionStore,
  ClaudeCanonicalStream,
  buildProjection,
  normalizeLegacyState,
  type HookEventName,
  type HookEventPayload,
  type CommonAgentState,
} from '@claude-alive/core';
import { openDatabase } from '../db.js';
import { runMigrations } from '../migrator.js';
import { EventStore } from '../eventStore.js';

const SESSION = 'claude-session-1';
const CWD = '/repo/alpha';
const TRANSCRIPT = '/home/u/.claude/projects/alpha/session.jsonl';

let t = 0;
function hook(event: HookEventName, data: Partial<HookEventPayload['data']> = {}): HookEventPayload {
  t += 10;
  return {
    event,
    tool: data.tool_name ?? '',
    session_id: SESSION,
    timestamp: 1_700_000_000_000 + t,
    data: {
      session_id: SESSION,
      hook_event_name: event,
      cwd: CWD,
      transcript_path: TRANSCRIPT,
      ...data,
    },
  };
}

/** The facts both pipelines are expected to agree on. */
interface ComparableFacts {
  state: CommonAgentState;
  cwd: string | undefined;
  transcriptPath: string | undefined;
  lastPrompt: string | undefined;
  toolsUsed: string[];
  toolCallCount: number;
}

function v1Facts(events: HookEventPayload[]): ComparableFacts {
  const store = new SessionStore();
  for (const e of events) store.processEvent(e);
  const agent = store.getAgent(SESSION)!;
  return {
    state: normalizeLegacyState(agent.state, agent.currentTool).common,
    cwd: agent.cwd || undefined,
    transcriptPath: agent.transcriptPath ?? undefined,
    lastPrompt: agent.lastPrompt ?? undefined,
    toolsUsed: [...agent.toolsUsed].sort(),
    toolCallCount: agent.toolCallCount,
  };
}

function v2Facts(events: HookEventPayload[]): ComparableFacts {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const store = new EventStore(db);

  const stream = new ClaudeCanonicalStream();
  let n = 0;
  for (const e of events) {
    for (const canonical of stream.push(e, {
      sessionId: SESSION,
      workspaceId: 'W1',
      receivedAt: e.timestamp,
      newEventId: () => `E${++n}`,
    })) {
      store.append(canonical);
    }
  }

  const { events: persisted } = store.readAfter(0);
  const row = buildProjection(persisted).sessions[SESSION];
  return {
    state: row.state,
    cwd: row.cwd,
    transcriptPath: row.transcriptPath,
    lastPrompt: row.lastPrompt,
    toolsUsed: [...row.toolsUsed].sort(),
    toolCallCount: row.toolCallCount,
  };
}

function expectParity(events: HookEventPayload[]): void {
  expect(v2Facts(events)).toEqual(v1Facts(events));
}

describe('v1/v2 parity — session lifecycle', () => {
  test('a session that starts and takes a prompt', () => {
    t = 0;
    expectParity([hook('SessionStart', { source: 'startup' }), hook('UserPromptSubmit', { prompt: 'fix the bug' })]);
  });

  test('a full tool round trip', () => {
    t = 0;
    expectParity([
      hook('SessionStart'),
      hook('UserPromptSubmit', { prompt: 'run the tests' }),
      hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu1' }),
      hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu1' }),
    ]);
  });

  test('multiple distinct tools', () => {
    t = 0;
    expectParity([
      hook('SessionStart'),
      hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu1' }),
      hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu1' }),
      hook('PreToolUse', { tool_name: 'Read', tool_use_id: 'tu2' }),
      hook('PostToolUse', { tool_name: 'Read', tool_use_id: 'tu2' }),
      hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu3' }),
      hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu3' }),
    ]);
  });

  test('a permission request leaves both waiting on the user', () => {
    t = 0;
    expectParity([
      hook('SessionStart'),
      hook('UserPromptSubmit', { prompt: 'delete the file' }),
      hook('PermissionRequest', { tool_name: 'Bash' }),
    ]);
  });

  test('a run that stops', () => {
    t = 0;
    expectParity([
      hook('SessionStart'),
      hook('UserPromptSubmit', { prompt: 'summarise' }),
      hook('Stop', { last_assistant_message: 'done' }),
    ]);
  });

  test('a tool in flight leaves both in using-tool', () => {
    t = 0;
    expectParity([hook('SessionStart'), hook('PreToolUse', { tool_name: 'Edit', tool_use_id: 'tu9' })]);
  });
});

describe('v1/v2 parity — Notification is overloaded', () => {
  test('a permission-style notification blocks on the user in both', () => {
    t = 0;
    expectParity([
      hook('SessionStart'),
      hook('UserPromptSubmit', { prompt: 'go' }),
      hook('Notification', { message: 'Claude needs your permission to use Bash' }),
    ]);
  });

  test('an idle notification must not be mistaken for a decision request', () => {
    t = 0;
    expectParity([
      hook('SessionStart'),
      hook('UserPromptSubmit', { prompt: 'go' }),
      hook('Notification', { message: 'Claude is waiting for your input' }),
    ]);
  });
});

describe('v1/v2 parity — redelivery', () => {
  test('a duplicated hook does not double-count tool calls on the v2 side', () => {
    t = 0;
    const base = [hook('SessionStart'), hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu1' })];
    // The same PreToolUse arrives twice (retry); dedupe must absorb it so the
    // v2 tool count still matches v1's single count.
    const v1 = v1Facts(base);
    const v2 = v2Facts([...base, base[1]]);
    expect(v2.toolCallCount).toBe(v1.toolCallCount);
  });
});

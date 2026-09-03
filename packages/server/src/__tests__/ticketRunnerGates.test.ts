/**
 * Runner-level behaviour of the two review gates: the auto-commit that follows a
 * passing verdict, and the advisory panel that tries to unblock a parked
 * decision before a human is asked.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ticket, TicketCommit, TicketDecisionPanel } from '@claude-alive/core';
import { createTicketStore, type TicketStore } from '../ticketStore.js';
import { createTicketRunner, type MainOutcome, type TicketRunnerOptions } from '../ticketRunner.js';

let dir: string;
let store: TicketStore;
let clock = 0;
const now = () => (clock += 100);

function outcome(result: string): MainOutcome {
  return { exitCode: 0, result: { result, isError: false }, sessionId: 'sess', stderr: '' };
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function makeRunner(overrides: Partial<TicketRunnerOptions> = {}) {
  return createTicketRunner({
    store,
    broadcast: () => {},
    spawnMain: () => ({ kill() {}, done: Promise.resolve(outcome('HEADLINE: done')) }),
    verify: async () => ({ passed: true, reason: 'ok' }),
    now,
    setTimer: () => () => {},
    canonicalize: (p) => p,
    cwdExists: () => true,
    ...overrides,
  });
}

const committed: TicketCommit = { committed: true, sha: 'abc1234', files: 1, at: 1 };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runnergates-'));
  store = createTicketStore({ filePath: join(dir, 't.json'), now, uuid: (() => { let n = 0; return () => `id-${++n}`; })() });
  clock = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('auto-commit', () => {
  it('commits once the gate passes and records the result on the ticket', async () => {
    const seen: Ticket[] = [];
    const runner = makeRunner({
      commitWork: async (t) => {
        seen.push(t);
        return committed;
      },
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'done');
    expect(store.get(t.id)?.commit).toEqual(committed);
    // The committer sees the verdict, so the message can quote it.
    expect(seen[0]?.verification?.passed).toBe(true);
  });

  it('does not commit a ticket the gate rejected', async () => {
    let called = false;
    const runner = makeRunner({
      verify: async () => ({ passed: false, reason: 'goal not met' }),
      commitWork: async () => {
        called = true;
        return committed;
      },
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'failed');
    expect(called).toBe(false);
    expect(store.get(t.id)?.commit).toBeUndefined();
  });

  it('honours a per-ticket opt-out', async () => {
    let called = false;
    const runner = makeRunner({
      commitWork: async () => {
        called = true;
        return committed;
      },
    });
    const t = await store.create({ goal: 'g', cwd: '/repo', autoCommit: false });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'done');
    expect(called).toBe(false);
  });

  it('still marks the ticket done when committing throws', async () => {
    const runner = makeRunner({
      commitWork: async () => {
        throw new Error('git exploded');
      },
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'done');
    expect(store.get(t.id)?.commit?.committed).toBe(false);
    expect(store.get(t.id)?.commit?.skipped).toContain('git exploded');
  });
});

describe('decision advisory panel', () => {
  const decided = (resolution: string): TicketDecisionPanel => ({
    stage: 'decided',
    question: 'A or B?',
    opinions: [],
    resolution,
    consensus: { agree: 2, total: 2 },
    at: 1,
  });

  /** First run asks a question; the resumed run finishes. */
  function twoPhaseSpawn(): { spawnMain: TicketRunnerOptions['spawnMain']; prompts: string[] } {
    const prompts: string[] = [];
    let call = 0;
    const spawnMain: TicketRunnerOptions['spawnMain'] = (_t, opts) => {
      call += 1;
      if (opts?.prompt) prompts.push(opts.prompt);
      return {
        kill() {},
        done: Promise.resolve(outcome(call === 1 ? 'DECISION: A or B?' : 'HEADLINE: done')),
      };
    };
    return { spawnMain, prompts };
  }

  it('answers the agent itself when the advisors converge, and the ticket finishes', async () => {
    const { spawnMain, prompts } = twoPhaseSpawn();
    const runner = makeRunner({ spawnMain, adviseDecision: async () => decided('Go with A') });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'done');
    expect(prompts).toEqual(['Go with A']);
    expect(store.get(t.id)?.decisionPanel?.stage).toBe('decided');
    // The thread must not imply the human said it.
    const reply = store.get(t.id)?.turns?.find((turn) => turn.role === 'user');
    expect(reply?.by).toBe('panel');
  });

  it('leaves the ticket parked for the human when the advisors disagree', async () => {
    const { spawnMain, prompts } = twoPhaseSpawn();
    const runner = makeRunner({
      spawnMain,
      adviseDecision: async () => ({
        stage: 'failed' as const,
        question: 'A or B?',
        opinions: [],
        consensus: { agree: 1, total: 2 },
        reason: 'advisors did not converge on one answer',
        at: 1,
      }),
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.decisionPanel?.stage === 'failed');
    expect(store.get(t.id)?.state).toBe('decision');
    expect(prompts).toEqual([]);
    expect(store.get(t.id)?.decisionPanel?.reason).toContain('converge');
  });

  it('parks with no panel record at all when no panel is configured', async () => {
    const { spawnMain } = twoPhaseSpawn();
    const runner = makeRunner({ spawnMain });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'decision');
    expect(store.get(t.id)?.decisionPanel).toBeUndefined();
  });

  it('drops a late panel answer when the human replied first', async () => {
    const { spawnMain, prompts } = twoPhaseSpawn();
    let releasePanel!: () => void;
    const gate = new Promise<void>((r) => {
      releasePanel = r;
    });
    const runner = makeRunner({
      spawnMain,
      adviseDecision: async () => {
        await gate;
        return decided('Go with A');
      },
    });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.decisionPanel?.stage === 'deciding');

    await runner.reply(t.id, 'Human says B');
    releasePanel();
    await until(() => store.get(t.id)?.state === 'done');
    expect(prompts).toEqual(['Human says B']);
    // The panel's own reply never ran, so its stage is still the in-flight one.
    expect(store.get(t.id)?.decisionPanel?.stage).toBe('deciding');
  });

  it('hands a panel that a restart interrupted back to the human', async () => {
    const { spawnMain } = twoPhaseSpawn();
    const runner = makeRunner({ spawnMain });
    const t = await store.create({ goal: 'g', cwd: '/repo' });
    await store.update(t.id, {
      state: 'decision',
      decisionQuestion: 'A or B?',
      claudeSessionId: 'sess',
      decisionPanel: { stage: 'deciding', question: 'A or B?', opinions: [], at: 1 },
    });
    await runner.recover();
    expect(store.get(t.id)?.decisionPanel?.stage).toBe('failed');
    expect(store.get(t.id)?.decisionPanel?.reason).toContain('server restarted');
  });
});

describe('advisory panel exclusion', () => {
  it('parks with no panel record when the ticket may not leave the machine', async () => {
    let called = false;
    const runner = makeRunner({
      spawnMain: () => ({ kill() {}, done: Promise.resolve(outcome('DECISION: A or B?')) }),
      advisoryEnabled: () => false,
      adviseDecision: async () => {
        called = true;
        return { stage: 'decided' as const, question: 'q', opinions: [], resolution: 'A', at: 1 };
      },
    });
    const t = await store.create({ goal: 'g', cwd: '/repo', panelReview: false });
    runner.enqueue(t);
    await until(() => store.get(t.id)?.state === 'decision');
    await new Promise((r) => setTimeout(r, 20));
    expect(called).toBe(false);
    expect(store.get(t.id)?.decisionPanel).toBeUndefined();
  });
});

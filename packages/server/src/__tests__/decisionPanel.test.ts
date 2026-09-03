import { describe, it, expect } from 'vitest';
import {
  resolveConsensus,
  consensusKey,
  toDecisionOpinion,
  adviseDecision,
  buildDecisionPrompt,
  MIN_DECISION_CONFIDENCE,
} from '../panel/decisionPanel.js';
import type { Panel } from '../panel/litellmPanel.js';
import type { DecisionOpinion } from '@claude-alive/core';

const op = (model: string, over: Partial<DecisionOpinion> = {}): DecisionOpinion => ({
  model,
  recommendation: 'do the thing',
  rationale: 'because',
  ...over,
});

describe('consensusKey', () => {
  it('groups by the option label when there is one', () => {
    expect(consensusKey(op('a', { choice: 'B', recommendation: 'take B, the safer route' })))
      .toBe(consensusKey(op('b', { choice: 'B', recommendation: 'B is right' })));
  });
  it('groups by normalized text when there is no label', () => {
    expect(consensusKey(op('a', { recommendation: 'Use Postgres.' })))
      .toBe(consensusKey(op('b', { recommendation: 'use postgres' })));
  });
  it('keeps genuinely different answers apart', () => {
    expect(consensusKey(op('a', { recommendation: 'use postgres' })))
      .not.toBe(consensusKey(op('b', { recommendation: 'use mysql' })));
  });
});

describe('resolveConsensus', () => {
  it('adopts an answer two of three advisors reached independently', () => {
    const out = resolveConsensus([
      op('a', { choice: 'A', recommendation: 'A) ship it' }),
      op('b', { choice: 'A', recommendation: 'A) ship it now, the risk is small' }),
      op('c', { choice: 'B', recommendation: 'B) wait' }),
    ]);
    expect(out.stage).toBe('decided');
    // The fullest phrasing of the winning answer is what the agent receives.
    expect(out.resolution).toBe('A) ship it now, the risk is small');
    expect(out.consensus).toEqual({ agree: 2, total: 3 });
  });

  it('escalates a 1-1 split rather than picking a side', () => {
    const out = resolveConsensus([op('a', { choice: 'A' }), op('b', { choice: 'B' })]);
    expect(out.stage).toBe('failed');
    expect(out.consensus).toEqual({ agree: 1, total: 2 });
  });

  it('escalates a lone answer even when nobody contradicts it', () => {
    expect(resolveConsensus([op('a', { choice: 'A' })]).stage).toBe('failed');
  });

  it('escalates when the agreeing advisors were not confident', () => {
    const out = resolveConsensus([
      op('a', { choice: 'A', confidence: 0.2 }),
      op('b', { choice: 'A', confidence: 0.3 }),
    ]);
    expect(out.stage).toBe('failed');
    expect(out.reason).toContain('low confidence');
  });

  it('adopts when confident advisors agree', () => {
    const out = resolveConsensus([
      op('a', { choice: 'A', confidence: MIN_DECISION_CONFIDENCE }),
      op('b', { choice: 'A', confidence: 0.9 }),
    ]);
    expect(out.stage).toBe('decided');
  });

  it('ignores advisors that errored, and escalates when none answered', () => {
    const out = resolveConsensus([op('a', { error: 'timeout', recommendation: '' })]);
    expect(out.stage).toBe('failed');
    expect(out.consensus).toEqual({ agree: 0, total: 0 });
  });
});

describe('toDecisionOpinion', () => {
  it('reads choice, recommendation, rationale and confidence', () => {
    const o = toDecisionOpinion({
      model: 'grok',
      content: '{"choice":"b","recommendation":"pick B","rationale":"cheaper","confidence":0.8}',
    });
    expect(o).toMatchObject({ choice: 'B', recommendation: 'pick B', rationale: 'cheaper', confidence: 0.8 });
  });
  it('marks an unparseable answer as an error so it cannot vote', () => {
    expect(toDecisionOpinion({ model: 'x', content: 'I would go with B I think' })).toMatchObject({
      error: 'no parseable recommendation',
    });
  });
});

describe('buildDecisionPrompt', () => {
  it('carries the goal, the work so far and the question', () => {
    const p = buildDecisionPrompt('build X', 'did half of X', 'A) foo or B) bar?');
    expect(p).toContain('build X');
    expect(p).toContain('did half of X');
    expect(p).toContain('A) foo or B) bar?');
  });
});

describe('adviseDecision', () => {
  it('returns a decided panel when the advisors converge', async () => {
    const panel: Panel = {
      models: ['a', 'b'],
      run: async () => [
        { model: 'a', content: '{"choice":"A","recommendation":"go A","rationale":"r","confidence":0.9}' },
        { model: 'b', content: '{"choice":"A","recommendation":"go A now","rationale":"r","confidence":0.8}' },
      ],
    };
    const out = await adviseDecision({ panel, now: () => 5 }, { goal: 'g', result: null }, 'A or B?');
    expect(out.stage).toBe('decided');
    expect(out.resolution).toBe('go A now');
    expect(out.question).toBe('A or B?');
    expect(out.at).toBe(5);
  });

  it('escalates instead of throwing when the gateway is down', async () => {
    const panel: Panel = { models: ['a'], run: async () => { throw new Error('gateway down'); } };
    const out = await adviseDecision({ panel, now: () => 5 }, { goal: 'g', result: null }, 'q');
    expect(out.stage).toBe('failed');
    expect(out.reason).toBe('gateway down');
  });
});

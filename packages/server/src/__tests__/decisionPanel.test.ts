import { describe, it, expect } from 'vitest';
import {
  resolveConsensus,
  consensusKey,
  toDecisionOpinion,
  adviseDecision,
  buildDecisionPrompt,
  buildTiebreakPrompt,
  readTiebreakIndices,
  applyTiebreak,
  votersOf,
  MIN_DECISION_CONFIDENCE,
  NO_CONVERGENCE,
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


/**
 * Every case below is a real panel that escalated in production (ticket seq in
 * the name). All of them had a majority answer; only the string comparison
 * missed it.
 */
describe('label normalization recovers escalations that were not disagreements', () => {
  it('#279 — 옵션1 and OPTION1 are the same option', () => {
    const out = resolveConsensus([
      op('gemini', { recommendation: 'PR#42를 정본으로 간주하고 브랜치는 폐기하세요.', confidence: 0.9 }),
      op('grok', { choice: '옵션1', recommendation: 'PR#42를 정본으로 확정하고 폐기', confidence: 0.78 }),
      op('kimi', { choice: 'OPTION1', recommendation: 'Treat PR#42 as canonical and archive', confidence: 0.85 }),
    ]);
    expect(out.stage).toBe('decided');
    expect(out.consensus).toEqual({ agree: 2, total: 3 });
  });

  it('#297 — 2 and ② outvote ①', () => {
    const out = resolveConsensus([
      op('gemini', { choice: '2', recommendation: 'Coolify DB 행수 확인을 먼저', confidence: 0.95 }),
      op('grok', { choice: '②', recommendation: '② Coolify DB 행수 확인을 먼저 수행하라', confidence: 0.82 }),
      op('kimi', { choice: '①', recommendation: 'dRPC 키 로테이션 먼저', confidence: 0.85 }),
    ]);
    expect(out.stage).toBe('decided');
    expect(out.resolution).toContain('Coolify');
    expect(out.consensus).toEqual({ agree: 2, total: 3 });
  });

  it('#300 — the same compound answer punctuated two ways', () => {
    const out = resolveConsensus([
      op('gemini', { recommendation: 'Proceed with option (a) for both.', confidence: 1 }),
      op('grok', { choice: 'R-1:(A), R-7:(A)', recommendation: 'R-1은 답글 정정, R-7은 4커밋 분할', confidence: 0.88 }),
      op('kimi', { choice: 'R-1: A, R-7: A', recommendation: 'R-1: correction reply, R-7: split PR', confidence: 0.9 }),
    ]);
    expect(out.stage).toBe('decided');
    expect(out.consensus).toEqual({ agree: 2, total: 3 });
  });

  it('still escalates advisors who genuinely picked different options', () => {
    const out = resolveConsensus([
      op('a', { choice: '옵션1', confidence: 0.9 }),
      op('b', { choice: '2', confidence: 0.9 }),
      op('c', { choice: '③', confidence: 0.9 }),
    ]);
    expect(out.stage).toBe('failed');
    expect(out.reason).toBe(NO_CONVERGENCE);
  });
});

describe('applyTiebreak', () => {
  const voters = [
    op('a', { recommendation: 'do X', confidence: 0.9 }),
    op('b', { recommendation: 'X, but phrased differently', confidence: 0.9 }),
    op('c', { recommendation: 'do Y', confidence: 0.9 }),
  ];

  it('adopts a grouping that is a strict majority', () => {
    const out = applyTiebreak(voters, [0, 1]);
    expect(out?.stage).toBe('decided');
    // The answer handed back is one an advisor actually wrote.
    expect(out?.resolution).toBe('X, but phrased differently');
    expect(out?.consensus).toEqual({ agree: 2, total: 3 });
  });

  it('refuses a grouping that is not a majority', () => {
    expect(applyTiebreak(voters, [0])).toBeNull();
    expect(applyTiebreak([voters[0]!, voters[2]!], [0])).toBeNull();
  });

  it('cannot bypass the confidence gate', () => {
    const unsure = [
      op('a', { recommendation: 'do X', confidence: 0.2 }),
      op('b', { recommendation: 'X again', confidence: 0.2 }),
      op('c', { recommendation: 'do Y', confidence: 0.9 }),
    ];
    expect(applyTiebreak(unsure, [0, 1])).toBeNull();
  });
});

describe('readTiebreakIndices', () => {
  it('reads the indices, deduped and in range', () => {
    expect(readTiebreakIndices('{"agree":[1,0,1,7,-1],"why":"same plan"}', 3)).toEqual([0, 1]);
  });
  it('reads numeric strings a model may emit', () => {
    expect(readTiebreakIndices('{"agree":["0","2"]}', 3)).toEqual([0, 2]);
  });
  it('returns nothing for an absent, empty or unparseable grouping', () => {
    expect(readTiebreakIndices(null, 3)).toEqual([]);
    expect(readTiebreakIndices('{"agree":[]}', 3)).toEqual([]);
    expect(readTiebreakIndices('not json', 3)).toEqual([]);
  });
});

describe('buildTiebreakPrompt', () => {
  it('numbers the answers so the judge can point at them', () => {
    const p = buildTiebreakPrompt('A or B?', [
      op('a', { choice: '1', recommendation: 'take A' }),
      op('b', { recommendation: 'A is right' }),
    ]);
    expect(p).toContain('[0] (1) take A');
    expect(p).toContain('[1] A is right');
    expect(p).toContain('A or B?');
  });
});

describe('votersOf', () => {
  it('drops advisors that errored or said nothing', () => {
    const all = [
      op('a', { recommendation: 'x' }),
      op('b', { recommendation: '', error: 'timeout' }),
      op('c', { recommendation: '' }),
    ];
    expect(votersOf(all).map((o) => o.model)).toEqual(['a']);
  });
});

describe('adviseDecision semantic tiebreak', () => {
  /** #305: three advisors said "option 1 for all three items" three ways. */
  const scattered = [
    { model: 'gemini', content: '{"recommendation":"Proceed with Option 1 for all three items","rationale":"r","confidence":1}' },
    { model: 'grok', content: '{"choice":"옵션1×3","recommendation":"3건 모두 추천 옵션1로 진행","rationale":"r","confidence":0.9}' },
    { model: 'kimi', content: '{"choice":"1-1-1","recommendation":"96 브랜치는 정정 후 머지, cutover는 기록만, 1f50a616은 태그","rationale":"r","confidence":0.9}' },
  ];

  const panelWith = (tiebreak: string | null): Panel => ({
    models: ['gemini', 'grok', 'kimi'],
    run: async (req) =>
      req.models?.length === 1
        ? [{ model: 'gemini', content: tiebreak }]
        : scattered,
  });

  it('#305 — adopts the answer the advisors already shared', async () => {
    const out = await adviseDecision(
      { panel: panelWith('{"agree":[0,1,2],"why":"all three pick option 1 everywhere"}'), now: () => 7 },
      { goal: 'g', result: null },
      '3건 선택 필요',
    );
    expect(out.stage).toBe('decided');
    expect(out.consensus).toEqual({ agree: 3, total: 3 });
    expect(out.tiebreak).toEqual({ model: 'gemini', why: 'all three pick option 1 everywhere' });
    // Grounded: the resolution is an advisor's own wording, never the judge's.
    expect(scattered.some((m) => m.content!.includes(out.resolution!))).toBe(true);
  });

  it('keeps the escalation when the judge finds no majority', async () => {
    const out = await adviseDecision(
      { panel: panelWith('{"agree":[0],"why":"nobody else agrees"}'), now: () => 7 },
      { goal: 'g', result: null },
      'q',
    );
    expect(out.stage).toBe('failed');
    expect(out.reason).toBe(NO_CONVERGENCE);
    expect(out.tiebreak).toBeUndefined();
  });

  it('keeps the escalation when the tiebreak itself fails', async () => {
    const panel: Panel = {
      models: ['gemini'],
      run: async (req) => {
        if (req.models?.length === 1) throw new Error('tiebreak gateway down');
        return scattered;
      },
    };
    const out = await adviseDecision({ panel, now: () => 7 }, { goal: 'g', result: null }, 'q');
    expect(out.stage).toBe('failed');
    expect(out.reason).toBe(NO_CONVERGENCE);
  });

  it('does not spend a tiebreak call when the labels already agreed', async () => {
    let calls = 0;
    const panel: Panel = {
      models: ['a', 'b'],
      run: async () => {
        calls += 1;
        return [
          { model: 'a', content: '{"choice":"옵션1","recommendation":"go 1","rationale":"r","confidence":0.9}' },
          { model: 'b', content: '{"choice":"OPTION 1","recommendation":"go 1 now","rationale":"r","confidence":0.9}' },
        ];
      },
    };
    const out = await adviseDecision({ panel, now: () => 7 }, { goal: 'g', result: null }, 'q');
    expect(out.stage).toBe('decided');
    expect(calls).toBe(1);
  });
});

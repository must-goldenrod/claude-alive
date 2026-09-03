import { describe, it, expect } from 'vitest';
import {
  mergeVerdict,
  toOpinion,
  reviewWithPanel,
  buildVerificationPanelPrompt,
} from '../panel/verificationPanel.js';
import type { Panel, PanelMemberResult } from '../panel/litellmPanel.js';
import type { VerificationOpinion } from '@claude-alive/core';

const pass = (model: string, reason = 'ok'): VerificationOpinion => ({ model, passed: true, reason });
const fail = (model: string, reason = 'not met'): VerificationOpinion => ({ model, passed: false, reason });
const abstain = (model: string): VerificationOpinion => ({ model, passed: null, reason: '', error: 'timeout' });

describe('toOpinion', () => {
  it('reads a verdict out of a fenced answer', () => {
    const m: PanelMemberResult = { model: 'grok', respondedModel: 'grok-4.5', content: '```json\n{"passed":false,"reason":"tests missing"}\n```' };
    expect(toOpinion(m)).toEqual({ model: 'grok', respondedModel: 'grok-4.5', passed: false, reason: 'tests missing' });
  });
  it('abstains when the member never answered', () => {
    expect(toOpinion({ model: 'x', content: null, error: 'HTTP 429' })).toMatchObject({ passed: null, error: 'HTTP 429' });
  });
  it('abstains rather than guessing when the answer has no verdict', () => {
    expect(toOpinion({ model: 'x', content: 'looks fine to me' })).toMatchObject({ passed: null, error: 'no parseable verdict' });
  });
});

describe('mergeVerdict', () => {
  it('passes when the gate and the panel agree', () => {
    const v = mergeVerdict({ passed: true, reason: 'build green' }, [pass('a'), pass('b')], 1);
    expect(v.passed).toBe(true);
    expect(v.reason).toBe('build green');
    expect(v.consensus).toEqual({ agree: 3, total: 3 });
  });

  it('lets a MAJORITY of the panel veto a gate PASS', () => {
    const v = mergeVerdict({ passed: true, reason: 'looks done' }, [fail('a', 'solved a different problem'), fail('b'), pass('c')], 1);
    expect(v.passed).toBe(false);
    expect(v.reason).toContain('solved a different problem');
    expect(v.consensus).toEqual({ agree: 2, total: 4 });
  });

  it('does NOT let a single dissenter veto a gate PASS', () => {
    const v = mergeVerdict({ passed: true, reason: 'done' }, [fail('a'), pass('b'), pass('c')], 1);
    expect(v.passed).toBe(true);
    expect(v.consensus).toEqual({ agree: 3, total: 4 });
  });

  it('keeps the gate authoritative on a FAIL regardless of the panel', () => {
    const v = mergeVerdict({ passed: false, reason: 'tests red' }, [pass('a'), pass('b')], 1);
    expect(v.passed).toBe(false);
    expect(v.reason).toBe('tests red');
  });

  it('degrades to the gate alone when every member abstained', () => {
    const v = mergeVerdict({ passed: true, reason: 'done' }, [abstain('a'), abstain('b')], 1);
    expect(v.passed).toBe(true);
    expect(v.consensus).toEqual({ agree: 1, total: 1 });
  });

  it('records the gate verdict and the panel separately from the summary', () => {
    const v = mergeVerdict({ passed: true, reason: 'g' }, [pass('a')], 42);
    expect(v.gate).toEqual({ passed: true, reason: 'g' });
    expect(v.panel).toHaveLength(1);
    expect(v.at).toBe(42);
  });
});

describe('buildVerificationPanelPrompt', () => {
  it('carries the goal, the report, and the first reviewer verdict', () => {
    const p = buildVerificationPanelPrompt('add X', 'I added X', { passed: true, reason: 'saw the diff' });
    expect(p).toContain('add X');
    expect(p).toContain('I added X');
    expect(p).toContain('PASS — saw the diff');
  });
});

describe('reviewWithPanel', () => {
  const panelOf = (answers: string[]): Panel => ({
    models: answers.map((_, i) => `m${i}`),
    run: async () => answers.map((content, i) => ({ model: `m${i}`, content })),
  });

  it('does not spend panel calls when the gate already failed', async () => {
    let called = false;
    const panel: Panel = { models: ['m'], run: async () => { called = true; return []; } };
    const v = await reviewWithPanel({ panel, now: () => 1 }, { goal: 'g' }, 'r', { passed: false, reason: 'nope' });
    expect(called).toBe(false);
    expect(v.passed).toBe(false);
  });

  it('folds panel answers into the verdict', async () => {
    const panel = panelOf(['{"passed":false,"reason":"scope"}', '{"passed":false,"reason":"scope"}']);
    const v = await reviewWithPanel({ panel, now: () => 1 }, { goal: 'g' }, 'r', { passed: true, reason: 'ok' });
    expect(v.passed).toBe(false);
  });

  it('falls back to the gate when the whole panel throws', async () => {
    const panel: Panel = { models: ['m'], run: async () => { throw new Error('gateway down'); } };
    const v = await reviewWithPanel({ panel, now: () => 1 }, { goal: 'g' }, 'r', { passed: true, reason: 'ok' });
    expect(v.passed).toBe(true);
    expect(v.panel).toBeUndefined();
  });
});

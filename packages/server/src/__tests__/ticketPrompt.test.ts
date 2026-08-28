import { describe, it, expect } from 'vitest';
import { buildMainPrompt, buildOrchestratorPrompt, HEADLINE_INSTRUCTION } from '../ticketPrompt.js';
import { DELEGATE_MODELS } from '../orchestrator/delegateModels.js';

describe('buildMainPrompt', () => {
  it('appends the HEADLINE instruction to the goal', () => {
    const out = buildMainPrompt('do the thing');
    expect(out).toBe(`do the thing${HEADLINE_INSTRUCTION}`);
  });

  it('is byte-identical to the goal+suffix when no guide is given', () => {
    expect(buildMainPrompt('g', '')).toBe(buildMainPrompt('g'));
    expect(buildMainPrompt('g', '   ')).toBe(buildMainPrompt('g'));
  });

  it('prepends the guide before the goal when present', () => {
    const out = buildMainPrompt('refactor', 'Learned: prefer X');
    expect(out.startsWith('Learned: prefer X\n\n---\nrefactor')).toBe(true);
    expect(out.endsWith(HEADLINE_INSTRUCTION)).toBe(true);
  });
});

describe('buildOrchestratorPrompt', () => {
  // A hardcoded model id in the prompt went stale against the gateway and every
  // delegation the agent tried came back HTTP 400. The caller now owns the id.
  it('embeds the delegate command and the default model it was given', () => {
    const out = buildOrchestratorPrompt('goal', '', '/bin/ca-delegate', 'glm-5.2');
    expect(out).toContain('/bin/ca-delegate --model <모델> "<하위 작업 프롬프트>"');
    expect(out).toContain('모델을 생략하면 glm-5.2');
    expect(out).not.toContain('gemini-2.5-flash-lite');
  });

  // An orchestrator told about one model uses one model — the menu is what makes
  // per-subtask routing (code → kimi, second opinion → grok) possible at all.
  it('lists the whole model menu and the fallback contract', () => {
    const out = buildOrchestratorPrompt('goal', '', '/bin/ca-delegate', 'glm-5.2');
    for (const m of DELEGATE_MODELS) expect(out).toContain(m.id);
    expect(out).toContain('--no-fallback');
    expect(out).toContain('--list-models');
  });

  it('keeps the guide prefix and the HEADLINE suffix', () => {
    const out = buildOrchestratorPrompt('goal', 'Learned: prefer X', '/bin/ca-delegate', 'kimi-k3');
    expect(out.startsWith('Learned: prefer X\n\n---\n')).toBe(true);
    expect(out).toContain('목표: goal');
    expect(out.endsWith(HEADLINE_INSTRUCTION)).toBe(true);
  });
});

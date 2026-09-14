import { describe, it, expect } from 'vitest';
import { classifyAgentQuotaError } from '../agentQuotaError.js';

describe('classifyAgentQuotaError', () => {
  it.each([
    'Claude AI usage limit reached|1726300800',
    "You've hit your limit · resets 3pm (Asia/Seoul)",
    "You're out of extra usage",
    'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
    'spend limit reached (daily; resets 2026-08-08 00:00 UTC)',
    'Credit balance is too low',
  ])('flags %s as usage-limit', (text) => {
    expect(classifyAgentQuotaError([text])?.reason).toBe('usage-limit');
  });

  it('flags an inaccessible model as model-unavailable', () => {
    const r = classifyAgentQuotaError([
      null,
      "There's an issue with the selected model (claude-fable-5-1). It may not exist or you may not have access to it.",
    ]);
    expect(r?.reason).toBe('model-unavailable');
    expect(r?.summary).toContain('claude-fable-5-1');
  });

  it('keeps the CLI message in the summary so the reset time is visible', () => {
    const r = classifyAgentQuotaError(['other line', "You've hit your limit · resets 3pm"]);
    expect(r?.summary).toContain('resets 3pm');
    expect(r?.summary).not.toContain('other line');
  });

  it('leaves ordinary failures alone', () => {
    expect(classifyAgentQuotaError(['TypeError: x is undefined', 'at line 429'])).toBeUndefined();
    expect(classifyAgentQuotaError([null, undefined, ''])).toBeUndefined();
  });
});

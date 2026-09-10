import { describe, it, expect } from 'vitest';
import { VERDICT_LANGUAGE_RULE } from '../verdictLanguage.js';
import { buildVerificationPrompt } from '../ticketVerifier.js';
import { VERIFICATION_SYSTEM } from '../panel/verificationPanel.js';
import { DECISION_SYSTEM, TIEBREAK_SYSTEM } from '../panel/decisionPanel.js';

/**
 * Every prompt whose answer is stored on a ticket and read by a human. A new
 * judging prompt added without the language rule shows up here rather than as
 * an English sentence in the failure line.
 */
const JUDGING_PROMPTS: [string, string][] = [
  ['completion gate', buildVerificationPrompt('목표', '보고')],
  ['completion gate (orchestrated)', buildVerificationPrompt('목표', '보고', true)],
  ['verification panel', VERIFICATION_SYSTEM],
  ['decision advisors', DECISION_SYSTEM],
  ['decision tiebreak', TIEBREAK_SYSTEM],
];

describe('verdict output language', () => {
  it('requires Korean for the strings a human reads', () => {
    expect(VERDICT_LANGUAGE_RULE).toContain('Korean');
    expect(VERDICT_LANGUAGE_RULE).toContain('한국어');
  });

  it('leaves machine-readable parts explicitly exempt', () => {
    // Translating a JSON key or a file path would break the parser or the copy-paste.
    expect(VERDICT_LANGUAGE_RULE).toContain('JSON keys');
    expect(VERDICT_LANGUAGE_RULE).toContain('true/false');
  });

  it.each(JUDGING_PROMPTS)('%s carries the rule', (_name, prompt) => {
    expect(prompt).toContain(VERDICT_LANGUAGE_RULE);
  });

  it.each(JUDGING_PROMPTS)('%s states the rule last, after its criteria', (_name, prompt) => {
    // The judging criteria were fixed by measurement; a language instruction
    // interleaved with them would be a change to the experiment, not to wording.
    expect(prompt.trimEnd().endsWith(VERDICT_LANGUAGE_RULE)).toBe(true);
  });
});

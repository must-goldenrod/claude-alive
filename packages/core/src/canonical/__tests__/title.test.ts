import { describe, expect, test } from 'vitest';
import {
  TITLE_MAX_GRAPHEMES,
  PREVIEW_MAX_GRAPHEMES,
  isMeaningfulPrompt,
  redactSecrets,
  generateTitleFromPrompt,
  pickTitleSource,
} from '../title.js';

describe('redactSecrets', () => {
  test('redacts openai/anthropic style sk- keys', () => {
    const out = redactSecrets('use key sk-ABCD1234efgh5678ijkl now');
    expect(out).not.toContain('sk-ABCD1234efgh5678ijkl');
    expect(out).toContain('[redacted]');
  });

  test('redacts github tokens', () => {
    const out = redactSecrets('token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
    expect(out).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
  });

  test('redacts bearer tokens', () => {
    const out = redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9.abc.def');
  });

  test('redacts key/token/password assignments', () => {
    const out = redactSecrets('api_key=supersecretvalue123 password: hunter2xyz');
    expect(out).not.toContain('supersecretvalue123');
    expect(out).not.toContain('hunter2xyz');
  });

  test('leaves ordinary text untouched', () => {
    const text = 'fix the failing login test';
    expect(redactSecrets(text)).toBe(text);
  });

  test('redacts secrets in JSON quoted-key form', () => {
    const out = redactSecrets('config {"password": "hunter2xyzzy", "api_key": "sk-shorty1"}');
    expect(out).not.toContain('hunter2xyzzy');
    expect(out).not.toContain('sk-shorty1');
  });

  test('redacts new github fine-grained PATs', () => {
    const out = redactSecrets('token github_pat_11ABCDEF0123456789_abcdefghijklmnop');
    expect(out).not.toContain('github_pat_11ABCDEF0123456789_abcdefghijklmnop');
  });

  test('does not over-redact ordinary prose after a keyword', () => {
    // The value here is short natural language, not a credential.
    const out = redactSecrets("guess the password: it's your birthday");
    expect(out).toContain("it's your birthday");
  });
});

describe('isMeaningfulPrompt', () => {
  test('empty or whitespace is not meaningful', () => {
    expect(isMeaningfulPrompt('')).toBe(false);
    expect(isMeaningfulPrompt('   \n\t ')).toBe(false);
  });

  test('a bare slash command is not meaningful', () => {
    expect(isMeaningfulPrompt('/clear')).toBe(false);
    expect(isMeaningfulPrompt('  /compact  ')).toBe(false);
    expect(isMeaningfulPrompt('/exit')).toBe(false);
  });

  test('normal instruction is meaningful', () => {
    expect(isMeaningfulPrompt('add a retry to the fetch helper')).toBe(true);
  });

  test('slash command with real content is meaningful', () => {
    // e.g. "/model then fix the bug" — has trailing meaningful content
    expect(isMeaningfulPrompt('/model opus and refactor auth')).toBe(true);
  });
});

describe('generateTitleFromPrompt', () => {
  test('returns null for non-meaningful prompt', () => {
    expect(generateTitleFromPrompt('/clear')).toBeNull();
    expect(generateTitleFromPrompt('   ')).toBeNull();
  });

  test('truncates ASCII to 10 graphemes plus ellipsis', () => {
    const res = generateTitleFromPrompt('abcdefghijklmnop');
    expect(res).not.toBeNull();
    expect(res!.title).toBe('abcdefghij…');
  });

  test('short prompt is used verbatim without ellipsis', () => {
    const res = generateTitleFromPrompt('fix bug');
    expect(res!.title).toBe('fix bug');
  });

  test('collapses newlines and repeated spaces', () => {
    const res = generateTitleFromPrompt('fix   the\n\n  bug');
    expect(res!.firstPromptPreview).toBe('fix the bug');
  });

  test('strips surrounding quotes', () => {
    const res = generateTitleFromPrompt('"fix the bug"');
    expect(res!.firstPromptPreview).toBe('fix the bug');
  });

  test('does not split composed Hangul mid-syllable', () => {
    // 11 Hangul syllables; must cut after exactly 10 clusters, not inside one
    const res = generateTitleFromPrompt('가나다라마바사아자차카');
    expect(res!.title).toBe('가나다라마바사아자차…');
  });

  test('does not split a ZWJ emoji family across the boundary', () => {
    // family emoji is one grapheme cluster; 10 short chars then the emoji
    const prompt = 'test bug ' + '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}' + ' more';
    const res = generateTitleFromPrompt(prompt);
    // first 10 graphemes: "test bug " (9) + family emoji (1) = 10, then ellipsis
    expect(res!.title).toBe('test bug \u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}…');
    // the emoji must never appear half-formed
    expect(res!.title).not.toMatch(/\u{1F468}(?!‍)/u);
  });

  test('preview is capped at 80 graphemes and redacted', () => {
    const secret = 'sk-ABCD1234efgh5678ijklmnop';
    const res = generateTitleFromPrompt(`please use ${secret} to authenticate the client`);
    expect(res!.firstPromptPreview).not.toContain(secret);
    expect([...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(res!.firstPromptPreview)].length)
      .toBeLessThanOrEqual(PREVIEW_MAX_GRAPHEMES + 1); // +1 for possible ellipsis
  });

  test('firstPrompt keeps the redacted-but-untruncated text', () => {
    const res = generateTitleFromPrompt('fix   the\n bug');
    expect(res!.firstPrompt).toBe('fix the bug');
  });

  test('exposes grapheme limits as constants', () => {
    expect(TITLE_MAX_GRAPHEMES).toBe(10);
    expect(PREVIEW_MAX_GRAPHEMES).toBe(80);
  });
});

describe('pickTitleSource', () => {
  const now = 1_700_000_000_000;

  test('manual title wins over everything', () => {
    const t = pickTitleSource({ manual: 'My title', providerTitle: 'prov', firstPrompt: 'do a thing', now });
    expect(t.titleSource).toBe('manual');
    expect(t.title).toBe('My title');
  });

  test('provider title used when no manual', () => {
    const t = pickTitleSource({ providerTitle: 'Provider Title', firstPrompt: 'do a thing', now });
    expect(t.titleSource).toBe('provider');
    expect(t.title).toBe('Provider Title');
  });

  test('first prompt used when no manual/provider', () => {
    const t = pickTitleSource({ firstPrompt: 'refactor the auth module deeply', now });
    expect(t.titleSource).toBe('first-prompt');
    expect(t.title).toBe('refactor t…');
    expect(t.firstPromptPreview).toBe('refactor the auth module deeply');
  });

  test('fallback when nothing usable', () => {
    const t = pickTitleSource({ firstPrompt: '/clear', now, fallbackClock: '14:05' });
    expect(t.titleSource).toBe('fallback');
    expect(t.title).toBe('새 세션 · 14:05');
  });

  test('trims a manual title but preserves the user intent verbatim', () => {
    // A manual title is the user's deliberate choice — not force-truncated to 10.
    const t = pickTitleSource({ manual: '  A deliberately long manual title  ', now });
    expect(t.title).toBe('A deliberately long manual title');
  });

  test('redacts secrets from an untrusted provider title', () => {
    const t = pickTitleSource({ providerTitle: '  session password=hunter2xyzzy  ', now });
    expect(t.titleSource).toBe('provider');
    expect(t.title).not.toContain('hunter2xyzzy');
    expect(t.title.startsWith(' ')).toBe(false);
  });
});

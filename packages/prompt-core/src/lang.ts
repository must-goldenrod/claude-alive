/**
 * Language detection for prompts.
 *
 * franc-min returns ISO 639-3 codes; we map a small set to ISO 639-1
 * codes (the form we store in DB and display in the dashboard).
 *
 * For very short prompts (< 20 chars) franc is unreliable, so we fall
 * back to simple unicode-range heuristics:
 *   - any hangul → 'ko'
 *   - any hiragana or katakana → 'ja'
 *   - any CJK unified ideographs (without kana/hangul) → 'zh'
 *   - otherwise → 'en' or 'und'
 */
import { franc } from 'franc-min';

export type LangCode = 'ko' | 'en' | 'ja' | 'zh' | 'und';

const ISO639_3_TO_1: Record<string, LangCode> = {
  kor: 'ko',
  eng: 'en',
  jpn: 'ja',
  cmn: 'zh', // Mandarin
  zho: 'zh',
  yue: 'zh', // Cantonese → map to zh for our purposes
};

function hasHangul(s: string): boolean {
  return /[\uAC00-\uD7A3]/.test(s);
}

function hasKana(s: string): boolean {
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(s);
}

function hasHan(s: string): boolean {
  return /[\u4E00-\u9FFF]/.test(s);
}

export function detectLanguage(text: string): LangCode {
  const t = text.trim();
  if (t.length === 0) return 'und';

  // Fast path for short CJK prompts where franc is unreliable.
  if (t.length < 20) {
    if (hasHangul(t)) return 'ko';
    if (hasKana(t)) return 'ja';
    if (hasHan(t)) return 'zh';
    return 'en';
  }

  // Also bias by unicode before franc: Korean & Japanese share ranges
  // with Chinese han, so prefer the strict indicators first.
  if (hasHangul(t)) return 'ko';
  if (hasKana(t)) return 'ja';

  const code = franc(t, { minLength: 10 });
  if (code === 'und') {
    if (hasHan(t)) return 'zh';
    return 'en'; // reasonable default for ASCII-only short text
  }
  return ISO639_3_TO_1[code] ?? 'und';
}

/**
 * Percentage (0-1) of characters belonging to Hangul / Kana / Han script.
 * Used by downstream rules (e.g. C-048 ko-en mix detection) to decide how
 * aggressively to run language-specific keyword checks.
 */
export function scriptRatios(text: string): {
  hangul: number;
  kana: number;
  han: number;
  latin: number;
  other: number;
} {
  if (text.length === 0) {
    return { hangul: 0, kana: 0, han: 0, latin: 0, other: 0 };
  }
  let hangul = 0;
  let kana = 0;
  let han = 0;
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp >= 0xac00 && cp <= 0xd7a3) hangul++;
    else if ((cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff)) kana++;
    else if (cp >= 0x4e00 && cp <= 0x9fff) han++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
    else other++;
  }
  const n = text.length;
  return {
    hangul: hangul / n,
    kana: kana / n,
    han: han / n,
    latin: latin / n,
    other: other / n,
  };
}

/**
 * Session title policy (spec §F.6).
 *
 * A session's display title is derived from the first *meaningful* user prompt,
 * unless a manual or provider-supplied title takes precedence. All derivation is
 * grapheme-aware (so composed Hangul and ZWJ emoji are never split) and passes
 * through secret redaction before any text is stored or shown.
 */

export const TITLE_MAX_GRAPHEMES = 10;
export const PREVIEW_MAX_GRAPHEMES = 80;

export type TitleSource = 'manual' | 'provider' | 'first-prompt' | 'fallback';

export interface SessionTitle {
  title: string;
  titleSource: TitleSource;
  firstPrompt?: string;
  firstPromptPreview?: string;
  generatedAt: number;
  updatedAt: number;
}

export interface TitleGenerationResult {
  /** Grapheme-truncated title (≤ TITLE_MAX_GRAPHEMES, plus `…` if truncated). */
  title: string;
  /** Sanitized, redacted, whitespace-normalized full prompt. */
  firstPrompt: string;
  /** Grapheme-truncated preview (≤ PREVIEW_MAX_GRAPHEMES, plus `…` if truncated). */
  firstPromptPreview: string;
}

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

const REDACTED = '[redacted]';

/**
 * Standalone high-entropy token patterns; the whole match becomes `[redacted]`.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{10,}/g, // OpenAI / Anthropic style keys
  /github_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PAT
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub classic tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /\b[Bb]earer\s+[A-Za-z0-9._~+/-]+=*/g, // bearer tokens
];

/**
 * `<key> = <value>` / `"<key>": "<value>"` assignments. Only the value is
 * replaced, and only when it is at least 8 non-space chars — long enough to be a
 * credential, short enough to spare ordinary prose ("password: it's ..."). The
 * key, separator, and any opening quote are kept so intent stays readable.
 */
const ASSIGNMENT_PATTERN =
  /(["']?\b(?:api[_-]?key|token|secret|password|passwd|pwd)\b["']?\s*[=:]\s*["']?)([^\s"',}]{8,})/gi;

export function redactSecrets(text: string): string {
  let out = text.replace(ASSIGNMENT_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED}`);
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/** Truncate to `max` grapheme clusters, appending `…` only when text was cut. */
function truncateGraphemes(text: string, max: number): string {
  const clusters: string[] = [];
  for (const { segment } of graphemeSegmenter.segment(text)) {
    clusters.push(segment);
    if (clusters.length > max) break;
  }
  if (clusters.length <= max) return text;
  return clusters.slice(0, max).join('') + '…';
}

function stripSurroundingQuotes(text: string): string {
  const m = text.match(/^(['"`])([\s\S]*)\1$/);
  return m ? m[2] : text;
}

/** Redact → collapse whitespace → strip wrapping quotes → trim. */
function sanitizePrompt(raw: string): string {
  const redacted = redactSecrets(raw);
  const collapsed = redacted.replace(/\s+/g, ' ').trim();
  return stripSurroundingQuotes(collapsed).trim();
}

/**
 * A prompt is meaningful if, after trimming, it is non-empty and is not a bare
 * CLI control command (a lone `/word` with no following instruction).
 */
export function isMeaningfulPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return false;
  if (/^\/[A-Za-z][\w-]*$/.test(trimmed)) return false;
  return true;
}

export function generateTitleFromPrompt(rawPrompt: string): TitleGenerationResult | null {
  if (!isMeaningfulPrompt(rawPrompt)) return null;
  const firstPrompt = sanitizePrompt(rawPrompt);
  if (firstPrompt.length === 0) return null;
  return {
    title: truncateGraphemes(firstPrompt, TITLE_MAX_GRAPHEMES),
    firstPrompt,
    firstPromptPreview: truncateGraphemes(firstPrompt, PREVIEW_MAX_GRAPHEMES),
  };
}

export interface PickTitleSourceInput {
  manual?: string;
  providerTitle?: string;
  firstPrompt?: string;
  now: number;
  /** `HH:mm` used only for the fallback title. */
  fallbackClock?: string;
}

/**
 * Resolve the effective title following the source priority
 * manual → provider → first-prompt → fallback (spec §F.6).
 */
export function pickTitleSource(input: PickTitleSourceInput): SessionTitle {
  const { manual, providerTitle, firstPrompt, now, fallbackClock } = input;

  if (manual && manual.trim().length > 0) {
    // The user's deliberate choice: trim only, never force-truncate or redact.
    return { title: manual.trim(), titleSource: 'manual', generatedAt: now, updatedAt: now };
  }

  if (providerTitle && providerTitle.trim().length > 0) {
    // Provider titles are external/untrusted and may echo user input: redact + trim.
    const title = redactSecrets(providerTitle).replace(/\s+/g, ' ').trim();
    if (title.length > 0) {
      return { title, titleSource: 'provider', generatedAt: now, updatedAt: now };
    }
  }

  if (firstPrompt) {
    const generated = generateTitleFromPrompt(firstPrompt);
    if (generated) {
      return {
        title: generated.title,
        titleSource: 'first-prompt',
        firstPrompt: generated.firstPrompt,
        firstPromptPreview: generated.firstPromptPreview,
        generatedAt: now,
        updatedAt: now,
      };
    }
  }

  const clock = fallbackClock ?? '';
  return {
    title: `새 세션 · ${clock}`.trimEnd(),
    titleSource: 'fallback',
    generatedAt: now,
    updatedAt: now,
  };
}

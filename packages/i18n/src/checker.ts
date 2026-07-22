/**
 * i18n parity and raw-text checks (spec §P0, §R.3 "i18n 누락 키 검사").
 *
 * Two independent guards:
 *  - `checkLocaleParity` — every key present in one locale exists, non-empty, in
 *    the other. A key that exists but is blank is a gap, not parity.
 *  - `findRawText` — user-facing literals in JSX that were never routed through
 *    `t()`. Heuristic by nature: it reports candidates for review, so it errs
 *    toward silence on things that are clearly not prose (punctuation, numbers,
 *    code blocks, styling attributes).
 */

export interface ParityResult {
  /** Keys in base that the target locale lacks. */
  missingInTarget: string[];
  /** Keys the target has that base lacks. */
  missingInBase: string[];
  /** Keys present in the target but blank. */
  emptyInTarget: string[];
  ok: boolean;
}

export type LocaleTree = Record<string, unknown>;

/** Flatten a locale tree into dotted paths. Arrays are leaves, not containers. */
export function flattenKeys(tree: LocaleTree, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...flattenKeys(value as LocaleTree, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/**
 * i18next plural suffixes. A locale only carries the forms its own plural rules
 * need — English has `_one`/`_other`, Korean has a single form — so parity is
 * compared on the base key, not on every variant.
 */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function baseKey(key: string): string {
  return key.replace(PLURAL_SUFFIX, '');
}

function valueAt(tree: LocaleTree, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => {
    if (node !== null && typeof node === 'object') return (node as LocaleTree)[part];
    return undefined;
  }, tree);
}

export function checkLocaleParity(base: LocaleTree, target: LocaleTree): ParityResult {
  const baseKeys = flattenKeys(base);
  const targetKeys = new Set(flattenKeys(target));
  const baseBases = new Set(baseKeys.map(baseKey));
  const targetBases = new Set([...targetKeys].map(baseKey));

  // Compare on base keys so a plural variant present in only one locale — which
  // is what correct pluralization looks like — is not reported as a gap.
  const missingInTarget = [...baseBases].filter((k) => !targetBases.has(k)).sort();
  const missingInBase = [...targetBases].filter((k) => !baseBases.has(k)).sort();
  const emptyInTarget = baseKeys.filter((k) => {
    if (!targetKeys.has(k)) return false; // absent variants are handled above
    const v = valueAt(target, k);
    return typeof v === 'string' && v.trim().length === 0;
  });

  return {
    missingInTarget,
    missingInBase,
    emptyInTarget,
    ok: missingInTarget.length === 0 && missingInBase.length === 0 && emptyInTarget.length === 0,
  };
}

export interface RawTextFinding {
  line: number;
  text: string;
  kind: 'jsx-text' | 'attribute';
  attribute?: string;
}

/** Attributes rendered to the user; everything else (className, id, …) is ignored. */
const USER_FACING_ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'label'];

/** Elements whose contents are literal by definition. */
const LITERAL_ELEMENTS = ['code', 'pre', 'script', 'style'];

/** Prose must contain at least two consecutive letters in some script. */
const HAS_WORD = /\p{L}{2,}/u;

/**
 * The `>…<` shape is not unique to JSX — TypeScript generics (`useState<Foo>(x)`)
 * and function types (`=> void;`) produce it too. Characters that are common in
 * code and rare in UI prose disqualify a candidate. This errs toward silence:
 * a missed string is a reviewer's job, a false alarm trains people to ignore the
 * checker.
 */
const CODE_SIGNALS = /[;=(){}[\]|&<>]/;

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function stripLiteralElements(source: string): string {
  let out = source;
  for (const tag of LITERAL_ELEMENTS) {
    // Replace contents with equivalent-length blanks so indices stay aligned.
    out = out.replace(new RegExp(`(<${tag}[^>]*>)([\\s\\S]*?)(</${tag}>)`, 'gi'), (_m, open, body, close) =>
      open + body.replace(/[^\n]/g, ' ') + close,
    );
  }
  return out;
}

export function findRawText(source: string): RawTextFinding[] {
  const scanned = stripLiteralElements(source);
  const findings: RawTextFinding[] = [];

  // JSX text nodes: between a closing `>` and the next `<`.
  for (const m of scanned.matchAll(/>([^<>{}]+)</g)) {
    const text = m[1].trim();
    if (!HAS_WORD.test(text)) continue;
    if (CODE_SIGNALS.test(text)) continue;
    findings.push({
      line: lineOf(scanned, (m.index ?? 0) + 1),
      text,
      kind: 'jsx-text',
    });
  }

  // User-facing attributes assigned a plain string literal.
  const attrPattern = new RegExp(`\\b(${USER_FACING_ATTRS.join('|')})\\s*=\\s*"([^"]*)"`, 'g');
  for (const m of scanned.matchAll(attrPattern)) {
    const text = m[2].trim();
    if (!HAS_WORD.test(text)) continue;
    findings.push({
      line: lineOf(scanned, m.index ?? 0),
      text,
      kind: 'attribute',
      attribute: m[1],
    });
  }

  return findings.sort((a, b) => a.line - b.line);
}

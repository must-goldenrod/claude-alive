/**
 * Normalising an advisor's option label.
 *
 * The decision panel groups advisors by the option they picked, and two models
 * that picked the *same* option write it down differently: `옵션1` / `OPTION1`,
 * `2` / `②`, `R-1:(A), R-7:(A)` / `R-1: A, R-7: A`. Comparing those raw strings
 * reports a disagreement that never happened, which parks the ticket on a human
 * for no reason — the failure mode this file exists to remove.
 *
 * What it deliberately does NOT do is guess at meaning. `1-1-1` and `옵션1×3`
 * are the same answer to a reader and stay different keys here; recovering those
 * is the semantic tiebreak's job, where a model — not a regex — makes the call.
 */

/** ①..⑳ in order, so the index is the number minus one. */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/** Words that decorate a number without changing which option it names. */
const OPTION_WORD = /(?:옵션|option|opt\.?|choice|안)\s*[#:.]?\s*(?=\d)/gi;
/** Korean ordinal suffix trailing a number: `1번`, `2번째`. */
const ORDINAL_SUFFIX = /(\d)\s*번(?:째)?/g;
/** Everything that is decoration rather than identity. */
const NOISE = /[^A-Z0-9가-힣]+/g;

/**
 * The comparable form of an option label. Two labels naming the same option
 * return the same string; an empty return means the label carried no identity
 * at all (`-`, `?`, punctuation) and the caller should fall back to the text.
 */
export function normalizeChoice(raw: string): string {
  const decircled = [...raw.normalize('NFKC')]
    .map((ch) => {
      const i = CIRCLED.indexOf(ch);
      return i >= 0 ? String(i + 1) : ch;
    })
    .join('');
  return decircled
    .replace(OPTION_WORD, '')
    .replace(ORDINAL_SUFFIX, '$1')
    .toUpperCase()
    .replace(NOISE, '');
}

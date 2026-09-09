/**
 * Terminal output, made readable on a phone.
 *
 * The pane is a `<pre>`, not an emulator, so the escape sequences a pty emits
 * would otherwise render as literal garbage. Stripping them loses colour and
 * cursor addressing — which a 390px screen could not have honoured anyway — and
 * keeps the words.
 */

// CSI (colour, cursor), OSC (window title, terminated by BEL or ST), and the
// short escapes a shell emits around prompts.
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const SHORT = /\x1b[()#][0-9A-Za-z]|\x1b[=><]/g;
const OTHER_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Keep the last of this much output; older lines scroll out of reach anyway. */
const MAX_CHARS = 120_000;

export function stripAnsi(text: string): string {
  return text
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(SHORT, '')
    // A bare CR rewrites the line in a real terminal; here it becomes a break so
    // a progress bar reads as successive values instead of one mangled line.
    .replace(/\r\n?/g, '\n')
    .replace(OTHER_CONTROL, '');
}

export function appendOutput(current: string, chunk: string): string {
  const next = current + stripAnsi(chunk);
  return next.length > MAX_CHARS ? next.slice(next.length - MAX_CHARS) : next;
}

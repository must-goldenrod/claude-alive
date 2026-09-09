/**
 * Terminal output, made readable on a phone.
 *
 * The pane is a `<pre>`, not an emulator, so the escape sequences a pty emits
 * would otherwise render as literal garbage. Stripping them loses colour and
 * cursor addressing — which a 390px screen could not have honoured anyway — and
 * keeps the words.
 *
 * The one piece of emulation kept is the carriage return, because dropping it
 * is what makes shell output unreadable: a shell redraws the line it is editing
 * several times per keystroke, and rendering each redraw as a new line turns
 * `echo hi` into four lines of half-typed text.
 */

// CSI (colour, cursor), OSC (window title, terminated by BEL or ST), and the
// short escapes a shell emits around prompts.
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const SHORT = /\x1b[()#][0-9A-Za-z]|\x1b[=><]/g;
// Everything except tab (\x09), newline (\x0a) and carriage return (\x0d).
const OTHER_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Keep the last of this much output; older lines scroll out of reach anyway. */
const MAX_CHARS = 120_000;

/**
 * Erase-to-end-of-line, kept as a marker rather than dropped.
 *
 * A shell redrawing a line writes the new text, then erases whatever the old
 * one left past it. Dropping the erase leaves that tail on screen — `echo hi`
 * overwriting `eecho hi` renders as `echo hii`. A private-use character carries
 * the instruction through the strip, and `overwrite` acts on it.
 */
const ERASE = '\uE000';
const ERASE_LINE = /\x1b\[[02]?K/g;

export function stripAnsi(text: string): string {
  return text
    .replace(OSC, '')
    .replace(ERASE_LINE, ERASE)
    .replace(CSI, '')
    .replace(SHORT, '')
    .replace(/\r\n/g, '\n')
    .replace(OTHER_CONTROL, '');
}

/**
 * Resolve carriage returns within one line: each one moves the cursor back to
 * column zero, so what follows overwrites from the start and anything longer
 * that was already there survives past it.
 */
function overwrite(line: string): string {
  if (!line.includes('\r') && !line.includes(ERASE)) return line;
  // The smallest cursor model that reproduces line editing: a column, an
  // overwrite, and a truncate. Anything more is a terminal emulator.
  let out = '';
  let column = 0;
  for (const ch of line) {
    if (ch === '\r') {
      column = 0;
    } else if (ch === ERASE) {
      out = out.slice(0, column);
    } else {
      out = out.slice(0, column) + ch + out.slice(column + 1);
      column += 1;
    }
  }
  return out;
}

export function appendOutput(current: string, chunk: string): string {
  // Lines already terminated in `current` are settled; everything from the last
  // newline onward is still open to rewriting — including lines the incoming
  // chunk completes, which is where a single frame usually carries both the
  // redraw and the newline that ends it.
  const settled = current.lastIndexOf('\n');
  const head = settled === -1 ? '' : current.slice(0, settled + 1);
  const pending = current.slice(settled + 1) + stripAnsi(chunk);
  const next = head + pending.split('\n').map(overwrite).join('\n');
  return next.length > MAX_CHARS ? next.slice(next.length - MAX_CHARS) : next;
}

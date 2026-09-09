import { describe, it, expect } from 'vitest';
import { stripAnsi, appendOutput } from '../ansi.ts';

const ESC = '\x1b';

describe('stripAnsi', () => {
  it('removes colour codes but keeps the text', () => {
    expect(stripAnsi(`${ESC}[32mok${ESC}[0m`)).toBe('ok');
  });
  it('removes cursor moves, and keeps the erase as a marker for appendOutput', () => {
    // stripAnsi is the first half: the erase survives as a private-use
    // character so the line model can act on it, then it is gone.
    expect(appendOutput('', `a${ESC}[2Kb${ESC}[1;5Hc`)).toBe('abc');
    expect(stripAnsi(`a${ESC}[1;5Hb`)).toBe('ab');
  });
  it('removes the OSC title sequence terminals emit constantly', () => {
    expect(stripAnsi(`${ESC}]0;my title\x07done`)).toBe('done');
  });
  it('leaves plain text alone', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
  it('keeps the carriage return for the caller to resolve', () => {
    expect(stripAnsi('50%\r100%')).toContain('\r');
  });
});

describe('appendOutput', () => {
  it('appends stripped output', () => {
    expect(appendOutput('a', `${ESC}[32mb${ESC}[0m`)).toBe('ab');
  });

  it('overwrites the line on a carriage return, as a terminal would', () => {
    // A progress bar rewrites one line; showing every value stacked is noise.
    expect(appendOutput('', 'loading 10%\rloading 99%')).toBe('loading 99%');
  });

  it('keeps the tail when the overwrite is shorter than what it replaces', () => {
    expect(appendOutput('', 'abcdef\rxy')).toBe('xycdef');
  });

  it('resolves a carriage return that arrives in a later chunk', () => {
    // The shell echoes, then redraws the same line in the next frame. Without
    // the erase it leaves the old tail behind, exactly as a terminal would.
    const first = appendOutput('', '$ eecho hi');
    expect(appendOutput(first, '\r$ echo hi')).toBe('$ echo hii');
  });

  it('erases the old tail when the shell asks it to', () => {
    const first = appendOutput('', '$ eecho hi');
    expect(appendOutput(first, `\r$ echo hi${ESC}[K`)).toBe('$ echo hi');
  });

  it('leaves earlier lines alone', () => {
    const out = appendOutput('done\n', 'x\ry');
    expect(out).toBe('done\ny');
  });

  it('caps the buffer so a chatty pty cannot grow the page without bound', () => {
    const out = appendOutput('x'.repeat(200_000), 'tail');
    expect(out.length).toBeLessThanOrEqual(120_000);
    expect(out.endsWith('tail')).toBe(true);
  });
});

describe('appendOutput — redraw and newline in one frame', () => {
  it('resolves the line even when the newline arrives with it', () => {
    // The shell delivers the echo redraw and the line break together; treating
    // only the tail as open left literal carriage returns on screen.
    const out = appendOutput('$ ', 'eecho hi\rm\rm-phone\r\nhello\n');
    expect(out).not.toContain('\r');
    expect(out).toContain('hello');
  });
});

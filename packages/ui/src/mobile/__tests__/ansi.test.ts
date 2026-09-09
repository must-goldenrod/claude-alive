import { describe, it, expect } from 'vitest';
import { stripAnsi, appendOutput } from '../ansi.ts';

const ESC = '\x1b';

describe('stripAnsi', () => {
  it('removes colour codes but keeps the text', () => {
    expect(stripAnsi(`${ESC}[32mok${ESC}[0m`)).toBe('ok');
  });
  it('removes cursor moves and clears', () => {
    expect(stripAnsi(`a${ESC}[2Kb${ESC}[1;5Hc`)).toBe('abc');
  });
  it('removes the OSC title sequence terminals emit constantly', () => {
    expect(stripAnsi(`${ESC}]0;my title\x07done`)).toBe('done');
  });
  it('turns a carriage return into a newline so progress lines stay readable', () => {
    expect(stripAnsi('50%\r100%')).toBe('50%\n100%');
  });
  it('leaves plain text alone', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
});

describe('appendOutput', () => {
  it('appends stripped output', () => {
    expect(appendOutput('a', `${ESC}[32mb${ESC}[0m`)).toBe('ab');
  });
  it('caps the buffer so a chatty pty cannot grow the page without bound', () => {
    const out = appendOutput('x'.repeat(200_000), 'tail');
    expect(out.length).toBeLessThanOrEqual(120_000);
    expect(out.endsWith('tail')).toBe(true);
  });
});

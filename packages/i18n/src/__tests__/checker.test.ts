import { describe, expect, test } from 'vitest';
import { checkLocaleParity, findRawText, flattenKeys } from '../checker.js';

describe('flattenKeys', () => {
  test('flattens nested objects into dotted paths', () => {
    expect(flattenKeys({ a: { b: 'x', c: 'y' }, d: 'z' }).sort()).toEqual(['a.b', 'a.c', 'd']);
  });

  test('treats arrays as leaves rather than recursing into indices', () => {
    expect(flattenKeys({ a: ['x', 'y'] })).toEqual(['a']);
  });
});

describe('checkLocaleParity', () => {
  test('reports parity when both locales have the same keys', () => {
    const r = checkLocaleParity({ a: '1', b: { c: '2' } }, { a: 'A', b: { c: 'B' } });
    expect(r.ok).toBe(true);
    expect(r.missingInTarget).toEqual([]);
    expect(r.missingInBase).toEqual([]);
  });

  test('reports keys missing from the target locale', () => {
    const r = checkLocaleParity({ a: '1', b: { c: '2' } }, { a: 'A' });
    expect(r.ok).toBe(false);
    expect(r.missingInTarget).toEqual(['b.c']);
  });

  test('reports extra keys the target has but the base does not', () => {
    const r = checkLocaleParity({ a: '1' }, { a: 'A', extra: 'E' });
    expect(r.ok).toBe(false);
    expect(r.missingInBase).toEqual(['extra']);
  });

  test('flags an empty translation as a gap, not as parity', () => {
    const r = checkLocaleParity({ a: '1' }, { a: '  ' });
    expect(r.ok).toBe(false);
    expect(r.emptyInTarget).toEqual(['a']);
  });
});

describe('findRawText', () => {
  test('flags a hardcoded JSX text node', () => {
    const found = findRawText('<div>Save changes</div>');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'jsx-text', text: 'Save changes' });
  });

  test('does not flag translated text', () => {
    expect(findRawText("<div>{t('actions.save')}</div>")).toEqual([]);
  });

  test('flags user-facing attributes with literal strings', () => {
    const found = findRawText('<input placeholder="Search sessions" />');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'attribute', attribute: 'placeholder', text: 'Search sessions' });
  });

  test('does not flag non-user-facing attributes', () => {
    expect(findRawText('<div className="flex gap-2" data-id="x" />')).toEqual([]);
  });

  test('ignores punctuation, numbers and single characters', () => {
    expect(findRawText('<span>·</span><span>42</span><span>/</span><span>—</span>')).toEqual([]);
  });

  test('ignores text inside a code or pre element', () => {
    expect(findRawText('<code>npm install</code>')).toEqual([]);
  });

  test('reports the line number of the finding', () => {
    const src = ['<div>', '  <span>Needs review</span>', '</div>'].join('\n');
    expect(findRawText(src)[0].line).toBe(2);
  });

  test('flags Korean literals too — the checker is language-agnostic', () => {
    const found = findRawText('<div>저장하기</div>');
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe('저장하기');
  });

  // The `>…<` shape also occurs in TypeScript generics and function types, which
  // are code, not prose. These are the real false positives the first version hit.
  test('does not flag TypeScript generics', () => {
    expect(findRawText('const [a, setA] = useState<Foo[]>(null);\nconst [b] = useState<Bar>(x);')).toEqual([]);
  });

  test('does not flag function type annotations', () => {
    expect(findRawText('onSelect?: (id: string) => void;\n  selectedSessionId?: string | null;')).toEqual([]);
  });

  test('does not flag expressions between generic brackets', () => {
    expect(findRawText("const n = xs.filter(s => !s.exited && s.status === 'active').length;\n  return new Set<string>(y);")).toEqual([]);
  });

  test('still flags multi-line prose inside an element', () => {
    const found = findRawText('<p>\n  This session needs review\n</p>');
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe('This session needs review');
  });
});

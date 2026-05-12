import { describe, expect, it } from 'vitest';
import { detectLanguage, scriptRatios } from '../src/lang.js';

describe('detectLanguage', () => {
  it('detects Korean', () => {
    expect(detectLanguage('이 프로젝트의 함수를 리팩터해줘')).toBe('ko');
  });

  it('detects Japanese', () => {
    expect(detectLanguage('このコードを直してください')).toBe('ja');
  });

  it('detects Chinese (no kana/hangul)', () => {
    expect(detectLanguage('请帮我分析这段代码的性能瓶颈。')).toBe('zh');
  });

  it('detects English', () => {
    expect(detectLanguage('Please refactor this function to be null-safe.')).toBe('en');
  });

  it('returns und for empty', () => {
    expect(detectLanguage('')).toBe('und');
  });

  it('handles mixed ko/en favoring hangul', () => {
    expect(detectLanguage('이 React 컴포넌트 좀 고쳐줘')).toBe('ko');
  });
});

describe('scriptRatios', () => {
  it('computes ratios', () => {
    const r = scriptRatios('hello 안녕 世界');
    expect(r.latin).toBeGreaterThan(0);
    expect(r.hangul).toBeGreaterThan(0);
    expect(r.han).toBeGreaterThan(0);
  });

  it('zeros on empty input', () => {
    const r = scriptRatios('');
    expect(r).toEqual({ hangul: 0, kana: 0, han: 0, latin: 0, other: 0 });
  });
});

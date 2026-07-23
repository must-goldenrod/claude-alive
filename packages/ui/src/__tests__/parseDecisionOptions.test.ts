import { describe, it, expect } from 'vitest';
import { parseDecisionOptions } from '../views/tickets/ticketDisplay.ts';

describe('parseDecisionOptions', () => {
  it('splits a "A) … B) … C) …" list with a stem', () => {
    const r = parseDecisionOptions('빌드 오류를 지금 고칠까요? A) 지금 수정 B) 다음 PR로 미룸 C) 무시');
    expect(r.prompt).toBe('빌드 오류를 지금 고칠까요?');
    expect(r.options).toEqual([
      { key: 'A', text: '지금 수정' },
      { key: 'B', text: '다음 PR로 미룸' },
      { key: 'C', text: '무시' },
    ]);
  });

  it('handles "A : … B : …" (spaced colon) and slash separators', () => {
    const r = parseDecisionOptions('방향 선택: A : 안정성 우선 / B : 속도 우선');
    expect(r.prompt).toBe('방향 선택');
    expect(r.options).toEqual([
      { key: 'A', text: '안정성 우선' },
      { key: 'B', text: '속도 우선' },
    ]);
  });

  it('handles numbered options', () => {
    const r = parseDecisionOptions('1. 리팩터링 2. 현상 유지');
    expect(r.prompt).toBe('');
    expect(r.options).toEqual([
      { key: '1', text: '리팩터링' },
      { key: '2', text: '현상 유지' },
    ]);
  });

  it('returns no options when there is no recognizable list', () => {
    const r = parseDecisionOptions('이 API를 v2로 마이그레이션할까요?');
    expect(r.options).toEqual([]);
    expect(r.prompt).toBe('이 API를 v2로 마이그레이션할까요?');
  });

  it('does not treat prose fragments (e.g. "3.14") as options', () => {
    const r = parseDecisionOptions('원주율 3.14를 상수로 뺄까요?');
    expect(r.options).toEqual([]);
  });

  it('rejects a non-sequential / non-A-starting run', () => {
    const r = parseDecisionOptions('foo B) bar D) baz');
    expect(r.options).toEqual([]);
  });
});

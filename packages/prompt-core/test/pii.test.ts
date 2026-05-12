import { describe, expect, it } from 'vitest';
import { maskPii } from '../src/pii.js';

describe('maskPii', () => {
  it('masks email', () => {
    const r = maskPii('reach me at john.doe@example.com please');
    expect(r.masked).toContain('<EMAIL>');
    expect(r.hits.email).toBe(1);
  });

  it('masks Korean phone', () => {
    const r = maskPii('전화 010-1234-5678');
    expect(r.masked).toContain('<PHONE>');
    expect(r.hits.phone_kr).toBe(1);
  });

  it('masks RRN', () => {
    const r = maskPii('주민번호 901231-1234567');
    expect(r.masked).toContain('<RRN>');
  });

  it('masks Anthropic key before generic sk-', () => {
    const r = maskPii('key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234');
    expect(r.masked).toContain('<ANTHROPIC_KEY>');
    expect(r.hits.anthropic_key).toBe(1);
    expect(r.hits.openai_key).toBeUndefined();
  });

  it('masks OpenAI key', () => {
    const r = maskPii('key=sk-proj-abcdefghijklmnopqrstuvwxyz1234');
    expect(r.masked).toContain('<OPENAI_KEY>');
  });

  it('masks IPv4', () => {
    const r = maskPii('server 192.168.1.100 is down');
    expect(r.masked).toContain('<IP>');
  });

  it('keeps innocuous text unchanged', () => {
    const r = maskPii('hello world this is a normal sentence');
    expect(r.masked).toBe('hello world this is a normal sentence');
    expect(Object.keys(r.hits)).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  classifyEvent,
  extractFinalAssistantText,
  extractFirstUserPrompt,
  parseTranscriptString,
  summarizeToolUse,
} from '../src/transcript/parser.js';

describe('classifyEvent', () => {
  it('classifies role=user', () => {
    const e = classifyEvent({ role: 'user', content: 'hello' });
    expect(e.kind).toBe('user');
    expect(e.text).toBe('hello');
  });

  it('classifies role=assistant with content array', () => {
    const e = classifyEvent({
      role: 'assistant',
      content: [{ type: 'text', text: 'hi there' }],
    });
    expect(e.kind).toBe('assistant');
    expect(e.text).toBe('hi there');
  });

  it('classifies tool_use', () => {
    const e = classifyEvent({ type: 'tool_use', tool_name: 'Bash', tool_input: { cmd: 'ls' } });
    expect(e.kind).toBe('tool_use');
    expect(e.toolName).toBe('Bash');
  });

  it('falls back to unknown', () => {
    const e = classifyEvent({ weird: 'shape' });
    expect(e.kind).toBe('unknown');
  });
});

describe('parseTranscriptString', () => {
  it('handles JSONL with blanks and malformed lines', () => {
    const text = [
      '{"role":"user","content":"first"}',
      '',
      'not json at all',
      '{"role":"assistant","content":[{"type":"text","text":"reply"}]}',
    ].join('\n');
    const events = parseTranscriptString(text);
    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe('user');
    expect(events[1]!.kind).toBe('assistant');
  });

  it('extractors work', () => {
    const text = [
      '{"role":"user","content":"question one"}',
      '{"role":"assistant","content":[{"type":"text","text":"answer one"}]}',
      '{"role":"user","content":"question two"}',
      '{"role":"assistant","content":[{"type":"text","text":"final answer"}]}',
    ].join('\n');
    const events = parseTranscriptString(text);
    expect(extractFirstUserPrompt(events)).toBe('question one');
    expect(extractFinalAssistantText(events)).toBe('final answer');
  });

  it('summarizes tool use', () => {
    const text = [
      '{"type":"tool_use","tool_name":"Read"}',
      '{"type":"tool_use","tool_name":"Read"}',
      '{"type":"tool_use","tool_name":"Edit"}',
    ].join('\n');
    const events = parseTranscriptString(text);
    const summary = summarizeToolUse(events);
    expect(summary).toContainEqual({ toolName: 'Read', calls: 2 });
    expect(summary).toContainEqual({ toolName: 'Edit', calls: 1 });
  });
});

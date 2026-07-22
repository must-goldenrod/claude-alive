import { describe, expect, test } from 'vitest';
import { parseTranscriptToConversation } from '../transcriptConversation.js';

/** One JSONL transcript line, as the Claude project transcript stores them. */
const line = (o: unknown) => JSON.stringify(o);

describe('parseTranscriptToConversation', () => {
  test('a string user message becomes a user item', () => {
    const items = parseTranscriptToConversation([
      line({ type: 'user', message: { role: 'user', content: 'fix the bug' } }),
    ]);
    expect(items).toEqual([expect.objectContaining({ kind: 'user', text: 'fix the bug' })]);
  });

  test('assistant text blocks become an assistant item', () => {
    const items = parseTranscriptToConversation([
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done, fixed it' }] } }),
    ]);
    expect(items).toEqual([expect.objectContaining({ kind: 'assistant', text: 'done, fixed it' })]);
  });

  test('multiple text blocks in one message are joined', () => {
    const items = parseTranscriptToConversation([
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }] } }),
    ]);
    expect(items[0].text).toBe('part one\n\npart two');
  });

  test('a tool_use becomes a running tool-call item', () => {
    const items = parseTranscriptToConversation([
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } }),
    ]);
    expect(items).toEqual([expect.objectContaining({ kind: 'tool-call', toolName: 'Bash', toolUseId: 'tu1', status: 'running' })]);
  });

  test('a tool_result completes the matching tool-call in place', () => {
    const items = parseTranscriptToConversation([
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash' }] } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'tool-call', toolUseId: 'tu1', status: 'completed' });
  });

  test('an errored tool_result marks the tool-call failed', () => {
    const items = parseTranscriptToConversation([
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash' }] } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true, content: 'boom' }] } }),
    ]);
    expect(items[0]).toMatchObject({ status: 'failed', detail: 'boom' });
  });

  test('a mixed assistant message yields text then tool-call, in order', () => {
    const items = parseTranscriptToConversation([
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'let me check' }, { type: 'tool_use', id: 't', name: 'Read' }] } }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['assistant', 'tool-call']);
  });

  test('meta and non-message lines are ignored', () => {
    const items = parseTranscriptToConversation([
      line({ type: 'queue-operation', operation: 'enqueue' }),
      line({ type: 'ai-title', title: 'x' }),
      line({ type: 'last-prompt', content: 'y' }),
      line({ type: 'attachment' }),
      line({ type: 'user', message: { content: 'real prompt' } }),
    ]);
    expect(items).toEqual([expect.objectContaining({ kind: 'user', text: 'real prompt' })]);
  });

  test('a tool_result with no preceding tool_use is not dropped silently', () => {
    const items = parseTranscriptToConversation([
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'orphan', content: 'x' }] } }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'tool-call', status: 'completed', toolUseId: 'orphan' });
  });

  test('an empty text block does not create an empty assistant item', () => {
    const items = parseTranscriptToConversation([
      line({ type: 'assistant', message: { content: [{ type: 'text', text: '' }] } }),
    ]);
    expect(items).toEqual([]);
  });

  test('a blank or malformed line never throws', () => {
    expect(() => parseTranscriptToConversation(['', 'not json', '{}'])).not.toThrow();
    expect(parseTranscriptToConversation(['', 'not json', '{}'])).toEqual([]);
  });

  test('the whole thing round-trips a small realistic session in order', () => {
    const items = parseTranscriptToConversation([
      line({ type: 'user', message: { content: 'run the tests' } }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'running them' }, { type: 'tool_use', id: 'tu1', name: 'Bash' }] } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '4 passed' }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'all green' }] } }),
    ]);
    expect(items.map((i) => `${i.kind}:${i.status ?? i.text?.slice(0, 12) ?? ''}`)).toEqual([
      'user:run the test',
      'assistant:running them',
      'tool-call:completed',
      'assistant:all green',
    ]);
  });
});

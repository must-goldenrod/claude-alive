import { describe, it, expect, vi } from 'vitest';
import { parseStreamJsonLine, createStreamJsonParser, type StreamEvent } from '../streamJson.js';

describe('parseStreamJsonLine', () => {
  it('classifies system init and extracts session id', () => {
    const e = parseStreamJsonLine('{"type":"system","subtype":"init","session_id":"abc-123"}');
    expect(e).toEqual({ kind: 'init', sessionId: 'abc-123' });
  });

  it('treats assistant/user messages as opaque activity', () => {
    expect(parseStreamJsonLine('{"type":"assistant","message":{}}')).toEqual({ kind: 'activity' });
    expect(parseStreamJsonLine('{"type":"user","message":{}}')).toEqual({ kind: 'activity' });
  });

  it('extracts the final result payload', () => {
    const e = parseStreamJsonLine(
      '{"type":"result","subtype":"success","is_error":false,"result":"done it","session_id":"s1"}',
    );
    expect(e).toEqual({
      kind: 'result',
      result: { result: 'done it', isError: false, sessionId: 's1', subtype: 'success', model: null, usage: null },
    });
  });

  it('extracts the model id from modelUsage, stripping the context-window suffix', () => {
    const e = parseStreamJsonLine(
      '{"type":"result","subtype":"success","is_error":false,"result":"ok","modelUsage":{"claude-opus-4-8[1m]":{"inputTokens":2}}}',
    );
    expect(e).toMatchObject({ kind: 'result', result: { model: 'claude-opus-4-8' } });
  });

  it('extracts token/cost/turn usage from the result event', () => {
    const e = parseStreamJsonLine(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'ok',
        total_cost_usd: 0.1234,
        num_turns: 7,
        duration_ms: 4200,
        modelUsage: {
          'claude-opus-4-8[1m]': {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 800,
            cacheCreationInputTokens: 20,
          },
        },
      }),
    );
    expect(e).toMatchObject({
      kind: 'result',
      result: {
        model: 'claude-opus-4-8',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 800,
          cacheCreationTokens: 20,
          totalTokens: 970,
          costUsd: 0.1234,
          numTurns: 7,
          durationMs: 4200,
        },
      },
    });
  });

  it('reports null usage when the result event has no accounting', () => {
    const e = parseStreamJsonLine('{"type":"result","subtype":"success","is_error":false,"result":"ok"}');
    expect(e).toMatchObject({ kind: 'result', result: { usage: null } });
  });

  it('marks error results', () => {
    const e = parseStreamJsonLine('{"type":"result","subtype":"error_max_turns","is_error":true}');
    expect(e).toMatchObject({ kind: 'result', result: { isError: true, subtype: 'error_max_turns', result: null } });
  });

  it('skips blank and malformed lines instead of throwing', () => {
    expect(parseStreamJsonLine('')).toBeNull();
    expect(parseStreamJsonLine('   ')).toBeNull();
    expect(parseStreamJsonLine('{not json')).toBeNull();
    expect(parseStreamJsonLine('42')).toBeNull();
    expect(parseStreamJsonLine('{"type":"tool_use"}')).toBeNull(); // unclassified
  });
});

describe('createStreamJsonParser', () => {
  it('emits one event per newline-terminated line', () => {
    const events: StreamEvent[] = [];
    const p = createStreamJsonParser((e) => events.push(e));
    p.push('{"type":"system","subtype":"init","session_id":"s"}\n{"type":"assistant","message":{}}\n');
    expect(events).toEqual([
      { kind: 'init', sessionId: 's' },
      { kind: 'activity' },
    ]);
  });

  it('buffers a partial line across chunk boundaries', () => {
    const events: StreamEvent[] = [];
    const p = createStreamJsonParser((e) => events.push(e));
    p.push('{"type":"result","subtype":"suc');
    expect(events).toHaveLength(0);
    p.push('cess","is_error":false,"result":"ok"}\n');
    expect(events).toEqual([
      { kind: 'result', result: { result: 'ok', isError: false, sessionId: null, subtype: 'success', model: null, usage: null } },
    ]);
  });

  it('flush() emits a trailing unterminated line', () => {
    const onEvent = vi.fn();
    const p = createStreamJsonParser(onEvent);
    p.push('{"type":"result","subtype":"success","is_error":false,"result":"tail"}');
    expect(onEvent).not.toHaveBeenCalled();
    p.flush();
    expect(onEvent).toHaveBeenCalledWith({
      kind: 'result',
      result: { result: 'tail', isError: false, sessionId: null, subtype: 'success', model: null, usage: null },
    });
  });
});

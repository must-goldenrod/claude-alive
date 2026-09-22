import { describe, it, expect, vi } from 'vitest';
import { ClientLLMSchema } from '@browserbasehq/stagehand';
import {
  toAnthropicRequest,
  fromAnthropicResponse,
  createClaudeLLM,
  DEFAULT_BROWSER_MODEL,
} from '../browser/claudeLLM.js';
import type { GenerateInput } from '../browser/claudeLLM.js';

const textInput = (text: string): GenerateInput => ({
  messages: [{ role: 'user', content: { type: 'text', text } }],
});

describe('toAnthropicRequest', () => {
  it('maps a single text block to Anthropic content', () => {
    const req = toAnthropicRequest(textInput('hello'), { model: 'claude-opus-5', maxTokens: 1024 });
    expect(req.model).toBe('claude-opus-5');
    expect(req.max_tokens).toBe(1024);
    expect(req.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('maps an array of blocks, preserving order', () => {
    const req = toAnthropicRequest(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      },
      { model: 'm', maxTokens: 10 },
    );
    expect(req.messages[0]!.content).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('moves systemPrompt to the top-level system field', () => {
    const req = toAnthropicRequest(
      { ...textInput('x'), systemPrompt: 'be terse' },
      { model: 'm', maxTokens: 10 },
    );
    expect(req.system).toBe('be terse');
  });

  it('translates responseFormat into output_config.format', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    const req = toAnthropicRequest(
      { ...textInput('x'), responseFormat: { type: 'json_schema', name: 'Res', schema } },
      { model: 'm', maxTokens: 10 },
    );
    expect(req.output_config).toEqual({
      format: { type: 'json_schema', name: 'Res', schema },
    });
  });

  it('does not set output_config for a text responseFormat', () => {
    const req = toAnthropicRequest(
      { ...textInput('x'), responseFormat: { type: 'text' } },
      { model: 'm', maxTokens: 10 },
    );
    expect((req as Record<string, unknown>)['output_config']).toBeUndefined();
  });

  it('maps an image block to an Anthropic base64 image source', () => {
    const req = toAnthropicRequest(
      {
        messages: [
          { role: 'user', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } },
        ],
      },
      { model: 'm', maxTokens: 10 },
    );
    expect(req.messages[0]!.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]);
  });

  it('maps tool_use and tool_result blocks', () => {
    const req = toAnthropicRequest(
      {
        messages: [
          { role: 'assistant', content: { type: 'tool_use', id: 't1', name: 'go', input: { u: 1 } } },
          {
            role: 'user',
            content: {
              type: 'tool_result',
              toolUseId: 't1',
              content: [{ type: 'text', text: 'done' }],
              isError: false,
            },
          },
        ],
      },
      { model: 'm', maxTokens: 10 },
    );
    expect(req.messages[0]!.content).toEqual([
      { type: 'tool_use', id: 't1', name: 'go', input: { u: 1 } },
    ]);
    expect(req.messages[1]!.content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'done' }], is_error: false },
    ]);
  });

  it('passes temperature and stopSequences through', () => {
    const req = toAnthropicRequest(
      { ...textInput('x'), temperature: 0.2, stopSequences: ['STOP'] },
      { model: 'm', maxTokens: 10 },
    );
    expect(req.temperature).toBe(0.2);
    expect(req.stop_sequences).toEqual(['STOP']);
  });

  it('maps declared tools', () => {
    const req = toAnthropicRequest(
      {
        ...textInput('x'),
        tools: [{ name: 'go', description: 'navigate', inputSchema: { type: 'object' } }],
      },
      { model: 'm', maxTokens: 10 },
    );
    expect(req.tools).toEqual([
      { name: 'go', description: 'navigate', input_schema: { type: 'object' } },
    ]);
  });
});

describe('fromAnthropicResponse', () => {
  const base = {
    id: 'msg_1',
    type: 'message' as const,
    role: 'assistant' as const,
    model: 'claude-opus-5',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 4 },
  };

  it('returns outputFormat "text" when no schema was requested', () => {
    const out = fromAnthropicResponse(
      { ...base, content: [{ type: 'text', text: 'hi', citations: null }], stop_reason: 'end_turn' } as never,
      false,
    );
    expect(out.outputFormat).toBe('text');
    expect(out.content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(out.stopReason).toBe('end_turn');
    expect(ClientLLMSchema.shape.generate._zod.def.output._zod.def.innerType.safeParse(out).success).toBe(true);
  });

  it('maps usage into the stagehand token shape', () => {
    const out = fromAnthropicResponse(
      { ...base, content: [{ type: 'text', text: 'hi', citations: null }], stop_reason: 'end_turn' } as never,
      false,
    );
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14 });
  });

  it('parses JSON text into structuredContent when a schema was requested', () => {
    const out = fromAnthropicResponse(
      { ...base, content: [{ type: 'text', text: '{"a":1}', citations: null }], stop_reason: 'end_turn' } as never,
      true,
    );
    expect(out.outputFormat).toBe('json_schema');
    expect(out).toMatchObject({ structuredContent: { a: 1 } });
  });

  it('strips code fences before parsing structured output', () => {
    const out = fromAnthropicResponse(
      { ...base, content: [{ type: 'text', text: '```json\n{"a":2}\n```', citations: null }], stop_reason: 'end_turn' } as never,
      true,
    );
    expect(out).toMatchObject({ structuredContent: { a: 2 } });
  });

  it('throws a descriptive error when structured output is not valid JSON', () => {
    expect(() =>
      fromAnthropicResponse(
        { ...base, content: [{ type: 'text', text: 'not json', citations: null }], stop_reason: 'end_turn' } as never,
        true,
      ),
    ).toThrow(/structured output/i);
  });

  it('throws on a refusal stop reason instead of returning empty content', () => {
    expect(() =>
      fromAnthropicResponse(
        { ...base, content: [], stop_reason: 'refusal' } as never,
        false,
      ),
    ).toThrow(/refus/i);
  });

  it('carries tool_use blocks back to stagehand', () => {
    const out = fromAnthropicResponse(
      {
        ...base,
        content: [{ type: 'tool_use', id: 't1', name: 'go', input: { u: 1 } }],
        stop_reason: 'tool_use',
      } as never,
      false,
    );
    expect(out.content).toEqual([{ type: 'tool_use', id: 't1', name: 'go', input: { u: 1 } }]);
  });
});

describe('createClaudeLLM', () => {
  it('satisfies the stagehand ClientLLM schema', () => {
    const llm = createClaudeLLM({ apiKey: 'sk-test', client: { messages: { create: vi.fn() } } as never });
    expect(ClientLLMSchema.safeParse(llm).success).toBe(true);
  });

  it('defaults to the configured browser model', () => {
    const create = vi.fn().mockResolvedValue({
      id: 'm', type: 'message', role: 'assistant', model: DEFAULT_BROWSER_MODEL,
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const llm = createClaudeLLM({ apiKey: 'sk-test', client: { messages: { create } } as never });
    return llm.generate(textInput('hi')).then(() => {
      expect(create.mock.calls[0]![0].model).toBe(DEFAULT_BROWSER_MODEL);
    });
  });

  it('treats a text responseFormat as an unstructured reply', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'm', type: 'message', role: 'assistant', model: DEFAULT_BROWSER_MODEL,
      content: [{ type: 'text', text: 'plain words' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const llm = createClaudeLLM({ apiKey: 'sk-test', client: { messages: { create } } as never });
    const out = await llm.generate({ ...textInput('hi'), responseFormat: { type: 'text' } });
    expect(out.outputFormat).toBe('text');
  });

  it('throws a clear error when no API key is available', () => {
    expect(() => createClaudeLLM({ apiKey: undefined })).toThrow(/ANTHROPIC_API_KEY/);
  });
});

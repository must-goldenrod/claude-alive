/**
 * Claude adapter for Stagehand's `ClientLLM` contract.
 *
 * Stagehand v4 does not talk to a provider itself — it hands the caller a
 * `{ generate }` callback and lets the host decide which model answers. This
 * module translates that callback to the Anthropic Messages API, so browser
 * automation runs on Claude without a Browserbase account or a second key
 * system.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ClientLLM } from '@browserbasehq/stagehand';

/** The model used for `observe`/`extract`/`act` unless a caller overrides it. */
export const DEFAULT_BROWSER_MODEL = 'claude-opus-5-5';

/** Output ceiling for one inference call. Stagehand replies are small. */
export const DEFAULT_MAX_TOKENS = 8192;

export type GenerateInput = Parameters<ClientLLM['generate']>[0];
export type GenerateOutput = Awaited<ReturnType<ClientLLM['generate']>>;

type StagehandBlock = Extract<GenerateInput['messages'][number]['content'], { type: string }>;
type AnthropicBlock = Anthropic.ContentBlockParam;

export interface RequestConfig {
  readonly model: string;
  readonly maxTokens: number;
}

export interface ClaudeLLMOptions {
  /** Anthropic API key. Falls back to `ANTHROPIC_API_KEY` when omitted. */
  readonly apiKey?: string | undefined;
  readonly model?: string;
  readonly maxTokens?: number;
  /** Override the API base URL (corporate proxy, or a local stub in tests). */
  readonly baseURL?: string;
  /** Injected for tests; a real `Anthropic` client is built when absent. */
  readonly client?: Pick<Anthropic, 'messages'>;
}

function toAnthropicBlock(block: StagehandBlock): AnthropicBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return {
        type: 'image',
        source: { type: 'base64', media_type: block.mimeType as 'image/png', data: block.data },
      };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content.map((c) => toAnthropicBlock(c as StagehandBlock)) as Anthropic.ToolResultBlockParam['content'],
        is_error: block.isError ?? false,
      };
    default: {
      const unknownBlock: never = block;
      throw new Error(`Unsupported Stagehand content block: ${JSON.stringify(unknownBlock)}`);
    }
  }
}

/** Translate one Stagehand `generate` input into an Anthropic request body. */
export function toAnthropicRequest(
  input: GenerateInput,
  config: RequestConfig,
): Anthropic.MessageCreateParamsNonStreaming {
  const messages: Anthropic.MessageParam[] = input.messages.map((message) => ({
    role: message.role,
    content: (Array.isArray(message.content) ? message.content : [message.content]).map((block) =>
      toAnthropicBlock(block as StagehandBlock),
    ),
  }));

  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.model,
    max_tokens: config.maxTokens,
    messages,
  };
  if (input.systemPrompt !== undefined) request.system = input.systemPrompt;
  if (input.temperature !== undefined) request.temperature = input.temperature;
  if (input.stopSequences !== undefined) request.stop_sequences = [...input.stopSequences];

  const tools = 'tools' in input ? input.tools : undefined;
  if (tools !== undefined && tools.length > 0) {
    request.tools = tools.map((tool) => ({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
    }));
  }

  const format = input.responseFormat;
  if (format !== undefined && format.type === 'json_schema') {
    (request as unknown as Record<string, unknown>)['output_config'] = {
      format: {
        type: 'json_schema',
        name: format.name,
        ...(format.description === undefined ? {} : { description: format.description }),
        schema: format.schema,
      },
    };
  }
  return request;
}

/** Remove a ```json fence so a fenced reply still parses as structured output. */
function stripFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
}

/** Translate an Anthropic response back into the shape Stagehand expects. */
export function fromAnthropicResponse(
  message: Anthropic.Message,
  wantsStructuredOutput: boolean,
): GenerateOutput {
  if (message.stop_reason === 'refusal') {
    const detail = (message as { stop_details?: { explanation?: string } }).stop_details?.explanation;
    throw new Error(`Claude refused the browser inference request${detail ? `: ${detail}` : ''}`);
  }

  const content = message.content.map((block): StagehandBlock => {
    if (block.type === 'text') return { type: 'text', text: block.text } as StagehandBlock;
    if (block.type === 'tool_use') {
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input } as StagehandBlock;
    }
    throw new Error(`Unsupported Anthropic content block in browser inference: ${block.type}`);
  });

  const usage = message.usage
    ? {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        totalTokens: message.usage.input_tokens + message.usage.output_tokens,
      }
    : undefined;

  const base = {
    role: 'assistant' as const,
    content,
    ...(message.stop_reason === null ? {} : { stopReason: message.stop_reason }),
    ...(usage === undefined ? {} : { usage }),
  };

  if (!wantsStructuredOutput) {
    return { ...base, outputFormat: 'text' } as GenerateOutput;
  }

  const parsed = (message as { parsed_output?: unknown }).parsed_output;
  if (parsed !== undefined && parsed !== null) {
    return { ...base, outputFormat: 'json_schema', structuredContent: parsed } as GenerateOutput;
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  try {
    return {
      ...base,
      outputFormat: 'json_schema',
      structuredContent: JSON.parse(stripFence(text)) as Record<string, unknown>,
    } as GenerateOutput;
  } catch (error) {
    throw new Error(
      `Claude returned structured output that is not valid JSON: ${String(error)} — body: ${text.slice(0, 200)}`,
    );
  }
}

/**
 * Build the `ClientLLM` Stagehand accepts as its `model`.
 * Throws early when no credential is available, so a browser run fails at
 * setup rather than on the first `observe()`.
 */
export function createClaudeLLM(options: ClaudeLLMOptions = {}): ClientLLM {
  const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (options.client === undefined && (apiKey === undefined || apiKey === '')) {
    throw new Error(
      'Claude browser automation needs an Anthropic credential: set ANTHROPIC_API_KEY in ~/.claude-alive/.env',
    );
  }
  const client =
    options.client ?? new Anthropic({ apiKey, ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }) });
  const config: RequestConfig = {
    model: options.model ?? DEFAULT_BROWSER_MODEL,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  };

  return {
    generate: async (input: GenerateInput) => {
      const request = toAnthropicRequest(input, config);
      const message = (await client.messages.create(request)) as Anthropic.Message;
      return fromAnthropicResponse(message, input.responseFormat?.type === 'json_schema');
    },
  } as ClientLLM;
}

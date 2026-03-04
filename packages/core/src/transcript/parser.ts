import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { TokenUsage } from '../events/types.js';

export type { TokenUsage };

export async function parseTranscriptTokens(filePath: string): Promise<TokenUsage | null> {
  const lastByMsgId = new Map<string, { usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }; model: string }>();

  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'assistant' || !entry.message?.id || !entry.message?.usage) continue;
        lastByMsgId.set(entry.message.id, { usage: entry.message.usage, model: entry.message.model });
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    return null;
  }

  if (lastByMsgId.size === 0) return null;

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let model = '';

  for (const msg of lastByMsgId.values()) {
    inputTokens += msg.usage.input_tokens ?? 0;
    outputTokens += msg.usage.output_tokens ?? 0;
    cacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0;
    cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
    if (msg.model) model = msg.model;
  }

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
    apiCalls: lastByMsgId.size,
    model,
  };
}

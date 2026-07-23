import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUsageLine, collectUsageRecords } from '../jsonlUsage.js';

const assistantLine = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-22T02:03:11.135Z',
    requestId: 'req_1',
    uuid: 'u1',
    message: {
      id: 'msg_1',
      model: 'claude-opus-4-8',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 5000,
      },
    },
    ...over,
  });

describe('parseUsageLine', () => {
  it('normalizes an assistant message into a priced record', () => {
    const parsed = parseUsageLine(assistantLine())!;
    expect(parsed.record.totalTokens).toBe(6030); // 10+20+1000+5000
    expect(parsed.record.cacheTokens).toBe(6000); // creation + read
    expect(parsed.record.model).toBe('claude-opus-4-8');
    expect(parsed.record.calls).toBe(1);
    // 10*5e-6 + 20*25e-6 + 1000*6.25e-6 + 5000*5e-7
    expect(parsed.record.costUsd).toBeCloseTo(0.00005 + 0.0005 + 0.00625 + 0.0025, 8);
    expect(parsed.key).toBe('msg_1:req_1');
  });

  it('skips non-assistant, usage-less, and malformed lines', () => {
    expect(parseUsageLine('')).toBeNull();
    expect(parseUsageLine('{bad json')).toBeNull();
    expect(parseUsageLine(JSON.stringify({ type: 'user', message: {} }))).toBeNull();
    expect(parseUsageLine(JSON.stringify({ type: 'assistant', message: { model: 'x' } }))).toBeNull();
  });

  it('drops zero-token messages and un-timestamped lines', () => {
    expect(parseUsageLine(assistantLine({ message: { id: 'm', model: 'claude-opus-4-8', usage: {} } }))).toBeNull();
    expect(parseUsageLine(assistantLine({ timestamp: 'not-a-date' }))).toBeNull();
  });
});

describe('collectUsageRecords', () => {
  it('dedups by message.id + requestId across files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-'));
    const sub = join(dir, 'projectA');
    await mkdir(sub, { recursive: true });
    // Same message id+req in two files → counted once. A distinct one → counted.
    await writeFile(join(sub, 'a.jsonl'), assistantLine() + '\n' + assistantLine() + '\n');
    await writeFile(
      join(sub, 'b.jsonl'),
      assistantLine() + '\n' + assistantLine({ requestId: 'req_2', message: { id: 'msg_2', model: 'claude-haiku-4-5', usage: { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }) + '\n',
    );

    const records = await collectUsageRecords(dir);
    expect(records).toHaveLength(2);
    const models = records.map((r) => r.model).sort();
    expect(models).toEqual(['claude-haiku-4-5', 'claude-opus-4-8']);
  });

  it('returns [] for a missing directory', async () => {
    expect(await collectUsageRecords(join(tmpdir(), 'does-not-exist-xyz'))).toEqual([]);
  });
});

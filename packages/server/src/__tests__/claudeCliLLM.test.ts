import { describe, it, expect, vi } from 'vitest';
import { ClientLLMSchema } from '@browserbasehq/stagehand';
import {
  buildCliArgs,
  flattenPrompt,
  parseCliResult,
  createClaudeCliLLM,
} from '../browser/claudeCliLLM.js';
import type { GenerateInput } from '../browser/claudeLLM.js';

const input = (text: string): GenerateInput => ({
  messages: [{ role: 'user', content: { type: 'text', text } }],
});

describe('buildCliArgs', () => {
  it('always runs headless with json output', () => {
    const args = buildCliArgs({ model: 'claude-haiku-4-5' });
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
  });

  it('passes the model through', () => {
    const args = buildCliArgs({ model: 'claude-opus-5' });
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5');
  });

  it('blocks every tool — inference only, no file or shell access', () => {
    const args = buildCliArgs({ model: 'm' });
    expect(args).toContain('--disallowed-tools');
    expect(args).toContain('--strict-mcp-config');
  });
});

describe('flattenPrompt', () => {
  it('joins text blocks with the system prompt first', () => {
    const prompt = flattenPrompt({ ...input('body text'), systemPrompt: 'sys rules' });
    expect(prompt.indexOf('sys rules')).toBeLessThan(prompt.indexOf('body text'));
  });

  it('appends a JSON-only instruction carrying the requested schema', () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const prompt = flattenPrompt({
      ...input('q'),
      responseFormat: { type: 'json_schema', name: 'Res', schema },
    });
    expect(prompt).toMatch(/JSON/);
    expect(prompt).toContain('"ok"');
  });

  it('labels assistant turns so multi-turn context survives flattening', () => {
    const prompt = flattenPrompt({
      messages: [
        { role: 'user', content: { type: 'text', text: 'first' } },
        { role: 'assistant', content: { type: 'text', text: 'second' } },
      ],
    });
    expect(prompt).toMatch(/assistant/i);
    expect(prompt).toContain('second');
  });

  it('drops image blocks rather than emitting a broken prompt', () => {
    const prompt = flattenPrompt({
      messages: [
        { role: 'user', content: [
          { type: 'text', text: 'look' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        ] },
      ],
    });
    expect(prompt).toContain('look');
    expect(prompt).not.toContain('AAAA');
  });
});

describe('parseCliResult', () => {
  const envelope = (result: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify([
      { type: 'system', subtype: 'init' },
      { type: 'result', is_error: false, result, usage: { input_tokens: 5, output_tokens: 7 }, ...extra },
    ]);

  it('returns the result text and usage', () => {
    const parsed = parseCliResult(envelope('hello'));
    expect(parsed.text).toBe('hello');
    expect(parsed.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
  });

  it('accepts a bare object envelope as well as an array', () => {
    const parsed = parseCliResult(JSON.stringify({ type: 'result', is_error: false, result: 'x' }));
    expect(parsed.text).toBe('x');
  });

  it('throws when the CLI reports an error', () => {
    expect(() => parseCliResult(envelope('boom', { is_error: true }))).toThrow(/claude cli/i);
  });

  it('throws on output that is not valid JSON', () => {
    expect(() => parseCliResult('not json at all')).toThrow(/parse/i);
  });

  it('throws when no result record is present', () => {
    expect(() => parseCliResult(JSON.stringify([{ type: 'system' }]))).toThrow(/result/i);
  });
});

describe('createClaudeCliLLM', () => {
  const runner = (stdout: string) => vi.fn().mockResolvedValue({ stdout, code: 0 });

  it('satisfies the stagehand ClientLLM schema', () => {
    const llm = createClaudeCliLLM({ run: runner('[]') });
    expect(ClientLLMSchema.safeParse(llm).success).toBe(true);
  });

  it('returns text output when no schema was requested', async () => {
    const run = runner(JSON.stringify([{ type: 'result', is_error: false, result: 'plain' }]));
    const llm = createClaudeCliLLM({ run });
    const out = await llm.generate(input('hi'));
    expect(out.outputFormat).toBe('text');
    expect(out.content).toEqual([{ type: 'text', text: 'plain' }]);
  });

  it('parses fenced JSON into structuredContent when a schema was requested', async () => {
    const run = runner(JSON.stringify([
      { type: 'result', is_error: false, result: '```json\n{"ok":true}\n```' },
    ]));
    const llm = createClaudeCliLLM({ run });
    const out = await llm.generate({
      ...input('hi'),
      responseFormat: { type: 'json_schema', name: 'R', schema: { type: 'object' } },
    });
    expect(out.outputFormat).toBe('json_schema');
    expect(out).toMatchObject({ structuredContent: { ok: true } });
  });

  it('strips nested-session env vars so the CLI does not refuse to start', async () => {
    const run = runner(JSON.stringify([{ type: 'result', is_error: false, result: 'x' }]));
    const llm = createClaudeCliLLM({ run, env: { CLAUDECODE: '1', PATH: '/usr/bin' } });
    await llm.generate(input('hi'));
    const passedEnv = run.mock.calls[0]![0].env as Record<string, string>;
    expect(passedEnv['CLAUDECODE']).toBeUndefined();
    expect(passedEnv['PATH']).toBe('/usr/bin');
  });
});

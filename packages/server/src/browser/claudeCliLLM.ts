/**
 * Claude CLI as Stagehand's inference backend.
 *
 * The Claude Code subscription credential cannot call `POST /v1/messages`
 * directly — that request authenticates but is refused with HTTP 429 — while
 * the `claude` CLI reaches the same models through its own path. This adapter
 * shells out to `claude -p`, so browser automation works on a machine that has
 * Claude Code logged in but no `ANTHROPIC_API_KEY`.
 *
 * It costs more per call than the API adapter: the CLI sends its own system
 * prompt and tool definitions (~30k cached tokens) on every invocation. Use
 * `claudeLLM.ts` when an API key is available; this is the fallback.
 */
import { spawn } from 'node:child_process';
import type { ClientLLM } from '@browserbasehq/stagehand';
import type { GenerateInput, GenerateOutput } from './claudeLLM.js';

/** Default when the caller does not pick one. Cheapest model that holds up here. */
export const DEFAULT_CLI_MODEL = 'claude-haiku-4-5';

/** Dropped from the child env: they make the CLI refuse as a nested session. */
const NESTED_SESSION_ENV = ['CLAUDECODE', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_ENTRYPOINT'];

export interface CliRunArgs {
  readonly args: readonly string[];
  readonly prompt: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

export type CliRunner = (args: CliRunArgs) => Promise<{ stdout: string; code: number | null }>;

export interface ClaudeCliLLMOptions {
  readonly model?: string;
  readonly binary?: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  /** Injected in tests; spawns the real CLI when absent. */
  readonly run?: CliRunner;
}

/** Inference only: no tools, no MCP servers, no repo context. */
export function buildCliArgs(config: { model: string }): string[] {
  return [
    '-p',
    '--output-format', 'json',
    '--model', config.model,
    '--disallowed-tools', '*',
    '--strict-mcp-config',
  ];
}

/** Collapse Stagehand's block messages into the single prompt the CLI takes. */
export function flattenPrompt(input: GenerateInput): string {
  const parts: string[] = [];
  if (input.systemPrompt !== undefined && input.systemPrompt !== '') parts.push(input.systemPrompt);

  for (const message of input.messages) {
    const blocks = Array.isArray(message.content) ? message.content : [message.content];
    const text = blocks
      .map((block) => {
        if (block.type === 'text') return block.text;
        if (block.type === 'tool_use') return `[tool_use ${block.name} ${JSON.stringify(block.input)}]`;
        if (block.type === 'tool_result') return `[tool_result ${block.toolUseId}]`;
        return '';
      })
      .filter((t) => t !== '')
      .join('\n');
    if (text === '') continue;
    parts.push(message.role === 'assistant' ? `(assistant) ${text}` : text);
  }

  const format = input.responseFormat;
  if (format !== undefined && format.type === 'json_schema') {
    parts.push(
      `Reply with JSON only — no prose, no explanation — matching this JSON Schema:\n${JSON.stringify(format.schema)}`,
    );
  }
  return parts.join('\n\n');
}

export interface CliResult {
  readonly text: string;
  readonly usage?: { inputTokens: number; outputTokens: number };
}

/** Pull the `result` record out of `--output-format json` output. */
export function parseCliResult(stdout: string): CliResult {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Could not parse claude CLI output: ${String(error)} — body: ${stdout.slice(0, 200)}`);
  }
  const records = Array.isArray(payload) ? payload : [payload];
  const record = records.find(
    (r): r is Record<string, unknown> =>
      typeof r === 'object' && r !== null && (r as { type?: unknown }).type === 'result',
  );
  if (record === undefined) throw new Error('claude CLI produced no result record');
  if (record['is_error'] === true) {
    throw new Error(`claude CLI reported an error: ${String(record['result']).slice(0, 200)}`);
  }

  const usage = record['usage'] as { input_tokens?: number; output_tokens?: number } | undefined;
  return {
    text: typeof record['result'] === 'string' ? record['result'] : '',
    ...(usage === undefined
      ? {}
      : { usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } }),
  };
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '').trim();
}

/** Spawn the real CLI, feeding the prompt on stdin to avoid argv length limits. */
function spawnRunner(binary: string): CliRunner {
  return ({ args, prompt, env, timeoutMs }) =>
    new Promise((resolve, reject) => {
      const child = spawn(binary, [...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`claude CLI exited ${String(code)}: ${stderr.slice(0, 300)}`));
          return;
        }
        resolve({ stdout, code });
      });
      child.stdin.end(prompt);
    });
}

/** Build a `ClientLLM` backed by the local `claude` CLI. */
export function createClaudeCliLLM(options: ClaudeCliLLMOptions = {}): ClientLLM {
  const model = options.model ?? DEFAULT_CLI_MODEL;
  const run = options.run ?? spawnRunner(options.binary ?? 'claude');
  const timeoutMs = options.timeoutMs ?? 120_000;

  const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env) };
  for (const key of NESTED_SESSION_ENV) delete env[key];

  return {
    generate: async (input: GenerateInput) => {
      const { stdout } = await run({
        args: buildCliArgs({ model }),
        prompt: flattenPrompt(input),
        env,
        timeoutMs,
      });
      const result = parseCliResult(stdout);
      const base = {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: result.text }],
        stopReason: 'end_turn',
        ...(result.usage === undefined
          ? {}
          : {
              usage: {
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                totalTokens: result.usage.inputTokens + result.usage.outputTokens,
              },
            }),
      };

      if (input.responseFormat?.type !== 'json_schema') {
        return { ...base, outputFormat: 'text' } as GenerateOutput;
      }
      try {
        return {
          ...base,
          outputFormat: 'json_schema',
          structuredContent: JSON.parse(stripFence(result.text)) as Record<string, unknown>,
        } as GenerateOutput;
      } catch (error) {
        throw new Error(
          `claude CLI returned structured output that is not valid JSON: ${String(error)} — body: ${result.text.slice(0, 200)}`,
        );
      }
    },
  } as ClientLLM;
}

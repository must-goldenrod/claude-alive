import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAgentServer } from '../src/server.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pp-agent-'));
  process.env.THINK_PROMPT_HOME = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.THINK_PROMPT_HOME;
});

describe('agent server', () => {
  it('health endpoint works', async () => {
    const app = buildAgentServer({ rootOverride: tmp });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    await app.close();
  });

  it('user-prompt-submit stores + scores', async () => {
    const app = buildAgentServer({ rootOverride: tmp });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hook/user-prompt-submit',
      payload: {
        session_id: 't1',
        cwd: '/tmp',
        prompt: 'fix',
      },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('coach_mode injects additionalContext for bad prompts', async () => {
    const app = buildAgentServer({
      rootOverride: tmp,
      config: {
        version: 1,
        agent: { port: 0, max_prompt_bytes: 262144, coach_mode: true, fail_open: true },
        dashboard: { port: 47824, open_on_start: false },
        privacy: {
          store_original: true,
          pii_mask: true,
          retention_days: 90,
          sync_to_server: false,
        },
        llm: {
          enabled: false,
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          api_key_env: 'ANTHROPIC_API_KEY',
          judge_threshold_score: 60,
          max_monthly_tokens: 500000,
        },
        rules: { enabled_set: 'default', custom_disabled: [] },
        i18n: 'ko',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hook/user-prompt-submit',
      payload: {
        session_id: 't2',
        cwd: '/tmp',
        prompt: 'fix',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Must follow Claude Code UserPromptSubmit hook response spec.
    // additionalContext belongs inside hookSpecificOutput, not at top level.
    expect(body.hookSpecificOutput).toBeDefined();
    expect(body.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(body.hookSpecificOutput.additionalContext).toContain('Think-Prompt coaching hint');
    // Regression guard: ensure the old (incorrect) top-level field is not emitted.
    expect(body.additionalContext).toBeUndefined();
    await app.close();
  });

  it('coach_mode omits hint for good prompts', async () => {
    const app = buildAgentServer({
      rootOverride: tmp,
      config: {
        version: 1,
        agent: { port: 0, max_prompt_bytes: 262144, coach_mode: true, fail_open: true },
        dashboard: { port: 47824, open_on_start: false },
        privacy: {
          store_original: true,
          pii_mask: true,
          retention_days: 90,
          sync_to_server: false,
        },
        llm: {
          enabled: false,
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          api_key_env: 'ANTHROPIC_API_KEY',
          judge_threshold_score: 60,
          max_monthly_tokens: 500000,
        },
        rules: { enabled_set: 'default', custom_disabled: [] },
        i18n: 'ko',
      },
    });
    const longGoodPrompt = [
      'Goal: extract the userId field from the response payload of POST /v1/users.',
      'Context: Node.js 20 TypeScript service in packages/api using Zod schemas.',
      'Task: add a narrowing helper that returns the userId or throws a typed error.',
      'Output format: return a TypeScript code block only, no prose.',
      'Success criteria: the helper compiles under strict mode and has a unit test.',
    ].join('\n');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hook/user-prompt-submit',
      payload: {
        session_id: 't2-good',
        cwd: '/tmp',
        prompt: longGoodPrompt,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // High-quality prompt: no coach hint should be attached.
    expect(body.hookSpecificOutput).toBeUndefined();
    expect(body.additionalContext).toBeUndefined();
    await app.close();
  });

  it('coach_mode disabled returns empty response even for bad prompts', async () => {
    const app = buildAgentServer({
      rootOverride: tmp,
      config: {
        version: 1,
        agent: { port: 0, max_prompt_bytes: 262144, coach_mode: false, fail_open: true },
        dashboard: { port: 47824, open_on_start: false },
        privacy: {
          store_original: true,
          pii_mask: true,
          retention_days: 90,
          sync_to_server: false,
        },
        llm: {
          enabled: false,
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          api_key_env: 'ANTHROPIC_API_KEY',
          judge_threshold_score: 60,
          max_monthly_tokens: 500000,
        },
        rules: { enabled_set: 'default', custom_disabled: [] },
        i18n: 'ko',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hook/user-prompt-submit',
      payload: {
        session_id: 't2-off',
        cwd: '/tmp',
        prompt: 'fix',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hookSpecificOutput).toBeUndefined();
    expect(body.additionalContext).toBeUndefined();
    await app.close();
  });

  it('post-tool-use upserts unknown session (FK-safe, regression for #11)', async () => {
    const { openDb } = await import('@think-prompt/core');
    const app = buildAgentServer({ rootOverride: tmp });
    // Simulate PostToolUse arriving before SessionStart / UserPromptSubmit:
    // the sessions row does not exist yet, which used to trip the
    // FOREIGN KEY constraint on tool_use_rollups.session_id.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hook/post-tool-use',
      payload: {
        session_id: 'ptu-unknown-session',
        cwd: '/tmp',
        tool_name: 'Bash',
        tool_input: { command: 'echo hi' },
        tool_response: 'hi',
      },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
    const db = openDb(tmp);
    const session = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get('ptu-unknown-session') as
      | { id: string }
      | undefined;
    expect(session?.id).toBe('ptu-unknown-session');
    const rollup = db
      .prepare(`SELECT call_count FROM tool_use_rollups WHERE session_id = ? AND tool_name = ?`)
      .get('ptu-unknown-session', 'Bash') as { call_count: number } | undefined;
    expect(rollup?.call_count).toBe(1);
    db.close();
  });

  it('subagent-stop enqueues parse job', async () => {
    const app = buildAgentServer({ rootOverride: tmp });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hook/subagent-stop',
      payload: {
        session_id: 't3',
        agent_id: 'a1',
        agent_type: 'Explore',
        agent_transcript_path: '/tmp/fake.jsonl',
      },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('/v1/ingest/web stores + scores + returns tier', async () => {
    const app = buildAgentServer({ rootOverride: tmp });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ingest/web',
      headers: { 'x-think-prompt-ext': '1' },
      payload: {
        source: 'chatgpt',
        browser_session_id: 'c-abc-123',
        prompt_text: 'fix',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.tier).toBeDefined();
    expect(Array.isArray(body.hits)).toBe(true);
    await app.close();
  });

  it('/v1/ingest/web tags sessions with the given source', async () => {
    const { openDb } = await import('@think-prompt/core');
    const app = buildAgentServer({ rootOverride: tmp });
    await app.inject({
      method: 'POST',
      url: '/v1/ingest/web',
      headers: { 'x-think-prompt-ext': '1' },
      payload: {
        source: 'claude-ai',
        browser_session_id: 'c-xyz-777',
        prompt_text: 'please refactor this function',
      },
    });
    await app.close();
    const db = openDb(tmp);
    const row = db.prepare(`SELECT source FROM sessions WHERE id = ?`).get('claude-ai:c-xyz-777') as
      | { source: string }
      | undefined;
    expect(row?.source).toBe('claude-ai');
    db.close();
  });

  it('/v1/ingest/web rejects requests missing the X-Think-Prompt-Ext header', async () => {
    const app = buildAgentServer({ rootOverride: tmp });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ingest/web',
      payload: {
        source: 'chatgpt',
        browser_session_id: 'c-nope',
        prompt_text: 'drive-by',
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.ok).toBe(false);
    await app.close();
  });

  it('/v1/ingest/web OPTIONS preflight responds 204 with CORS + PNA headers', async () => {
    const app = buildAgentServer({ rootOverride: tmp });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/ingest/web',
      headers: {
        origin: 'chrome-extension://abcdef',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-think-prompt-ext',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('chrome-extension://abcdef');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('x-think-prompt-ext');
    expect(res.headers['access-control-allow-private-network']).toBe('true');
    await app.close();
  });

  it('/v1/ingest/web POST response carries CORS headers for the browser client', async () => {
    const app = buildAgentServer({ rootOverride: tmp });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ingest/web',
      headers: {
        'x-think-prompt-ext': '1',
        origin: 'chrome-extension://abcdef',
      },
      payload: {
        source: 'chatgpt',
        browser_session_id: 'cors-check',
        prompt_text: 'please refactor this',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('chrome-extension://abcdef');
    expect(res.headers['access-control-allow-private-network']).toBe('true');
    await app.close();
  });
});

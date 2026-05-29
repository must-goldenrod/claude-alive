import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HookEventPayload } from '@claude-alive/core';
import { createPromptSubsystem, type PromptSubsystem } from '../src/subsystem.js';

/**
 * Integration coverage for the unified prompt-collection path that
 * claude-alive's server actually uses in production: a normalized
 * HookEventPayload flows through `ingest()` into SQLite, then back out via
 * the read-only `/api/prompts` route — no HTTP transport, no real Claude
 * Code. Each test gets a fresh temp DB via rootOverride so they're isolated.
 *
 * This is the server-side half of the collection feature; the hook transport
 * half (stream-event.sh) is guarded by packages/hooks stream-event.test.ts.
 */
describe('createPromptSubsystem ingest → /api/prompts', () => {
  let sub: PromptSubsystem;
  let tmpRoot: string;

  const userPrompt = (sessionId: string, prompt: string): HookEventPayload => ({
    event: 'UserPromptSubmit',
    tool: 'system',
    session_id: sessionId,
    timestamp: Date.now(),
    data: {
      session_id: sessionId,
      hook_event_name: 'UserPromptSubmit',
      cwd: '/tmp/proj',
      prompt,
    },
  });

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'pp-ingest-'));
    sub = createPromptSubsystem({ rootOverride: tmpRoot });
    await sub.fastify.ready();
  });

  afterEach(async () => {
    await sub.fastify.close();
    sub.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function listPrompts(sessionId?: string) {
    const url = sessionId
      ? `/api/prompts?session_id=${encodeURIComponent(sessionId)}`
      : '/api/prompts';
    const res = await sub.fastify.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    return res.json().prompts as Array<{
      session_id: string;
      prompt: string;
      char_len: number;
      tier: string | null;
      final_score: number | null;
    }>;
  }

  it('stores a UserPromptSubmit prompt and exposes it via /api/prompts', async () => {
    sub.ingest(userPrompt('s1', 'fix the payment form formatting bug'));

    const rows = await listPrompts('s1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.session_id).toBe('s1');
    expect(rows[0]!.prompt).toBe('fix the payment form formatting bug');
    expect(rows[0]!.char_len).toBeGreaterThan(0);
  });

  it('scores each collected prompt (quality tier is assigned)', async () => {
    sub.ingest(userPrompt('s1', 'please refactor the auth middleware and add tests'));

    const rows = await listPrompts('s1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tier).not.toBeNull();
    expect(rows[0]!.final_score).not.toBeNull();
  });

  it('collects every prompt submitted within a session', async () => {
    sub.ingest(userPrompt('s2', 'first prompt'));
    sub.ingest(userPrompt('s2', 'second prompt'));
    sub.ingest(userPrompt('s2', 'third prompt'));

    const rows = await listPrompts('s2');
    expect(rows).toHaveLength(3);
    // Don't assert ordering: /api/prompts sorts by created_at, which is only
    // second-granular, so three same-second inserts have no stable order.
    // Per-turn ordering is carried by turn_index, not exercised here.
    const texts = rows.map((r) => r.prompt).sort();
    expect(texts).toEqual(['first prompt', 'second prompt', 'third prompt']);
  });

  it('ignores an empty prompt (nothing to collect)', async () => {
    sub.ingest(userPrompt('s3', ''));

    const rows = await listPrompts('s3');
    expect(rows).toHaveLength(0);
  });

  it('does not throw on a non-prompt event (fail-open dispatcher)', async () => {
    const sessionStart: HookEventPayload = {
      event: 'SessionStart',
      tool: 'system',
      session_id: 's4',
      timestamp: Date.now(),
      data: { session_id: 's4', hook_event_name: 'SessionStart', cwd: '/tmp/proj' },
    };
    expect(() => sub.ingest(sessionStart)).not.toThrow();

    const rows = await listPrompts('s4');
    expect(rows).toHaveLength(0);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDeepAnalyses, insertDeepAnalysis } from '../src/db.js';
import { insertPromptUsage, openDb, upsertSession } from '../src/db.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tp-analysis-'));
  process.env.THINK_PROMPT_HOME = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.THINK_PROMPT_HOME;
});

describe('deep_analyses persistence', () => {
  it('round-trips a successful analysis row', () => {
    const db = openDb();
    upsertSession(db, { id: 's-a', cwd: '/tmp' });
    const u = insertPromptUsage(db, { session_id: 's-a', prompt_text: 'fix bug' });

    insertDeepAnalysis(db, {
      usage_id: u.id,
      model: 'claude-haiku-4-5',
      status: 'ok',
      problems: [{ category: 'too_short', severity: 3, explanation: 'prompt is too terse' }],
      reasoning: ['Step 1: clarify the target', 'Step 2: state the success criterion'],
      after_text: 'Fix the null-pointer bug in packages/api/src/auth.ts line 44.',
      applied_fixes: ['R001', 'R002'],
      input_tokens: 210,
      output_tokens: 340,
    });

    const rows = getDeepAnalyses(db, u.id);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.status).toBe('ok');
    expect(row?.problems).toHaveLength(1);
    expect(row?.problems[0]?.category).toBe('too_short');
    expect(row?.problems[0]?.severity).toBe(3);
    expect(row?.reasoning).toEqual([
      'Step 1: clarify the target',
      'Step 2: state the success criterion',
    ]);
    expect(row?.applied_fixes).toEqual(['R001', 'R002']);
    expect(row?.input_tokens).toBe(210);
    expect(row?.output_tokens).toBe(340);
    db.close();
  });

  it('stores a failed analysis with error_message', () => {
    const db = openDb();
    upsertSession(db, { id: 's-b', cwd: '/tmp' });
    const u = insertPromptUsage(db, { session_id: 's-b', prompt_text: 'hi' });

    insertDeepAnalysis(db, {
      usage_id: u.id,
      model: 'claude-haiku-4-5',
      status: 'failed',
      problems: [],
      reasoning: [],
      after_text: '',
      error_message: 'Anthropic API 429: rate limited',
    });

    const rows = getDeepAnalyses(db, u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.error_message).toContain('429');
    db.close();
  });

  it('returns history newest-first', async () => {
    const db = openDb();
    upsertSession(db, { id: 's-c', cwd: '/tmp' });
    const u = insertPromptUsage(db, { session_id: 's-c', prompt_text: 'something' });

    // `insertDeepAnalysis` stamps `created_at = new Date().toISOString()` at
    // millisecond resolution. Three synchronous calls on fast CI runners can
    // land in the same millisecond with identical ULIDs ordering, so the
    // "newest first" assertion becomes flaky. A small awaited delay forces
    // strictly increasing timestamps and makes the test deterministic across
    // Linux/macOS × Node 20/22.
    for (let i = 0; i < 3; i++) {
      insertDeepAnalysis(db, {
        usage_id: u.id,
        model: 'claude-haiku-4-5',
        status: 'ok',
        problems: [],
        reasoning: [`attempt #${i + 1}`],
        after_text: `rewrite ${i + 1}`,
      });
      await new Promise((resolve) => setTimeout(resolve, 3));
    }

    const rows = getDeepAnalyses(db, u.id);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.reasoning[0]).toBe('attempt #3');
    expect(rows[2]?.reasoning[0]).toBe('attempt #1');
    db.close();
  });
});

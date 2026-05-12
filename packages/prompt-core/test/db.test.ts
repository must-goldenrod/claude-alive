import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bumpToolRollup,
  endSession,
  finishSubagent,
  getMeta,
  insertPromptUsage,
  insertRuleHit,
  openDb,
  upsertQualityScore,
  upsertSession,
  upsertSubagent,
} from '../src/db.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pp-test-'));
  process.env.THINK_PROMPT_HOME = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.THINK_PROMPT_HOME;
});

describe('db', () => {
  it('initializes schema and meta', () => {
    const db = openDb(tmp);
    expect(getMeta(db, 'schema_version')).toBe('6');
    expect(getMeta(db, 'rules_version')).toBe('1');
    db.close();
  });

  it('upserts sessions and prompt_usages', () => {
    const db = openDb(tmp);
    upsertSession(db, { id: 's1', cwd: '/tmp', model: 'claude-opus' });
    const u = insertPromptUsage(db, { session_id: 's1', prompt_text: 'hello world' });
    expect(u.turn_index).toBe(0);
    expect(u.char_len).toBe(11);
    expect(u.word_count).toBe(2);
    const u2 = insertPromptUsage(db, { session_id: 's1', prompt_text: 'second turn' });
    expect(u2.turn_index).toBe(1);
    db.close();
  });

  it('handles end_session and rule_hits + scores', () => {
    const db = openDb(tmp);
    upsertSession(db, { id: 's2', cwd: '/tmp' });
    const u = insertPromptUsage(db, { session_id: 's2', prompt_text: 'fix' });
    insertRuleHit(db, { usage_id: u.id, rule_id: 'R001', severity: 2, message: 'short' });
    upsertQualityScore(db, {
      usage_id: u.id,
      rule_score: 95,
      final_score: 95,
      tier: 'good',
      rules_version: 1,
    });
    endSession(db, 's2');
    const row = db.prepare(`SELECT * FROM sessions WHERE id=?`).get('s2') as {
      ended_at: string | null;
      stop_count: number;
    };
    expect(row.ended_at).toBeTruthy();
    expect(row.stop_count).toBe(1);
    db.close();
  });

  it('subagent lifecycle + tool rollup', () => {
    const db = openDb(tmp);
    upsertSession(db, { id: 's3', cwd: '/tmp' });
    const subId = upsertSubagent(db, {
      session_id: 's3',
      agent_type: 'Explore',
      agent_id: 'sub-1',
    });
    // idempotent
    const subId2 = upsertSubagent(db, {
      session_id: 's3',
      agent_type: 'Explore',
      agent_id: 'sub-1',
    });
    expect(subId).toBe(subId2);
    finishSubagent(db, 's3', 'sub-1', {
      prompt_text: 'explore this',
      response_text: 'explored',
    });
    const sub = db.prepare(`SELECT * FROM subagent_invocations WHERE id=?`).get(subId) as {
      status: string;
      prompt_text: string;
    };
    expect(sub.status).toBe('completed');
    expect(sub.prompt_text).toBe('explore this');

    bumpToolRollup(db, {
      session_id: 's3',
      tool_name: 'Read',
      failed: false,
      ms: 100,
      in_bytes: 10,
      out_bytes: 200,
    });
    bumpToolRollup(db, {
      session_id: 's3',
      tool_name: 'Read',
      failed: true,
      ms: 50,
      in_bytes: 5,
      out_bytes: 0,
    });
    const roll = db
      .prepare(`SELECT * FROM tool_use_rollups WHERE session_id=? AND tool_name=?`)
      .get('s3', 'Read') as { call_count: number; fail_count: number; total_ms: number };
    expect(roll.call_count).toBe(2);
    expect(roll.fail_count).toBe(1);
    expect(roll.total_ms).toBe(150);
    db.close();
  });
});

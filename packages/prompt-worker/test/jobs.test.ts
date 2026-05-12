import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLogger,
  insertPromptUsage,
  insertRuleHit,
  loadConfig,
  openDb,
  upsertQualityScore,
  upsertSession,
  upsertSubagent,
} from '@think-prompt/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleParseSubagentTranscript, handleParseTranscript } from '../src/jobs.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pp-worker-'));
  process.env.THINK_PROMPT_HOME = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.THINK_PROMPT_HOME;
});

describe('worker jobs', () => {
  it('parses a subagent transcript and fills prompt/response', async () => {
    const db = openDb(tmp);
    upsertSession(db, { id: 's1', cwd: '/tmp' });
    upsertSubagent(db, {
      session_id: 's1',
      agent_type: 'Explore',
      agent_id: 'a1',
    });
    const transcriptPath = join(tmp, 'subagent.jsonl');
    writeFileSync(
      transcriptPath,
      [
        '{"role":"user","content":"explore the codebase"}',
        '{"role":"assistant","content":[{"type":"text","text":"Found 3 files."}]}',
      ].join('\n')
    );
    const logger = createLogger('test', { stdout: false, file: join(tmp, 'test.log') });
    const config = loadConfig(tmp);
    const result = await handleParseSubagentTranscript(
      { db, logger, config },
      { session_id: 's1', agent_id: 'a1', agent_transcript_path: transcriptPath }
    );
    expect(result).toBe('done');
    const sub = db
      .prepare(
        `SELECT prompt_text, response_text, status FROM subagent_invocations WHERE session_id=? AND agent_id=?`
      )
      .get('s1', 'a1') as { prompt_text: string; response_text: string; status: string };
    expect(sub.prompt_text).toBe('explore the codebase');
    expect(sub.response_text).toBe('Found 3 files.');
    expect(sub.status).toBe('completed');
    db.close();
  });

  it('drops job when transcript file missing (avoids DLQ flood)', async () => {
    const db = openDb(tmp);
    const logger = createLogger('test', { stdout: false, file: join(tmp, 'test.log') });
    const config = loadConfig(tmp);
    const result = await handleParseSubagentTranscript(
      { db, logger, config },
      { session_id: 's2', agent_id: 'a1', agent_transcript_path: '/nonexistent/file.jsonl' }
    );
    expect(result).toBe('done');
    db.close();
  });

  it('parses session transcript and recomputes usage scores', async () => {
    const db = openDb(tmp);
    upsertSession(db, { id: 's3', cwd: '/tmp' });
    const u = insertPromptUsage(db, { session_id: 's3', prompt_text: 'fix' });
    insertRuleHit(db, { usage_id: u.id, rule_id: 'R001', severity: 2, message: 'short' });
    upsertQualityScore(db, {
      usage_id: u.id,
      rule_score: 90,
      final_score: 90,
      tier: 'good',
      rules_version: 1,
    });
    const transcriptPath = join(tmp, 'session.jsonl');
    writeFileSync(
      transcriptPath,
      [
        '{"role":"user","content":"fix"}',
        '{"type":"tool_use","tool_name":"Read"}',
        '{"type":"tool_use","tool_name":"Edit"}',
        '{"role":"assistant","content":[{"type":"text","text":"done"}]}',
      ].join('\n')
    );
    const logger = createLogger('test', { stdout: false, file: join(tmp, 'test.log') });
    const config = loadConfig(tmp);
    await handleParseTranscript(
      { db, logger, config },
      { session_id: 's3', transcript_path: transcriptPath }
    );
    const q = db.prepare(`SELECT * FROM quality_scores WHERE usage_id=?`).get(u.id) as {
      rule_score: number;
    };
    expect(q.rule_score).toBe(90);
    db.close();
  });
});

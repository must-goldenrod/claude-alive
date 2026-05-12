import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type RunRulesFn,
  importClaudeHistory,
  parseSessionFile,
  scanClaudeHistory,
} from '../src/backfill.js';
import { insertPromptUsage, openDb, upsertSession } from '../src/db.js';

/** Build a fake `~/.claude/projects/<project>/<session>.jsonl` hierarchy. */
function setupFixtureRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'tp-backfill-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSessionFile(
  root: string,
  projectDir: string,
  sessionId: string,
  entries: Array<Record<string, unknown>>
): string {
  const dir = join(root, projectDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  const body = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(path, body, 'utf8');
  return path;
}

function userEntry(
  sessionId: string,
  cwd: string,
  timestamp: string,
  content: unknown
): Record<string, unknown> {
  return {
    type: 'user',
    message: { role: 'user', content },
    sessionId,
    cwd,
    timestamp,
    gitBranch: 'main',
    version: '2.1.109',
    uuid: `u-${Math.random().toString(36).slice(2)}`,
  };
}

describe('scanClaudeHistory', () => {
  it('returns rootExists=false when the directory is absent', () => {
    const { root, cleanup } = setupFixtureRoot();
    cleanup(); // remove it so it doesn't exist
    const stats = scanClaudeHistory(null, { root });
    expect(stats.rootExists).toBe(false);
    expect(stats.filesScanned).toBe(0);
  });

  it('counts user prompts in a single session file', () => {
    const { root, cleanup } = setupFixtureRoot();
    try {
      writeSessionFile(root, '-proj-a', 'session-1', [
        userEntry('session-1', '/proj/a', '2026-04-01T10:00:00.000Z', 'git pull'),
        userEntry('session-1', '/proj/a', '2026-04-01T10:05:00.000Z', 'run tests'),
        // An assistant entry must be ignored.
        {
          type: 'assistant',
          message: { role: 'assistant', content: 'ok' },
          sessionId: 'session-1',
          cwd: '/proj/a',
          timestamp: '2026-04-01T10:00:10.000Z',
        },
      ]);
      const stats = scanClaudeHistory(null, { root });
      expect(stats.rootExists).toBe(true);
      expect(stats.filesScanned).toBe(1);
      expect(stats.filesWithPrompts).toBe(1);
      expect(stats.totalUserEntries).toBe(2);
      expect(stats.extractablePrompts).toBe(2);
      expect(stats.newPrompts).toBe(2);
      expect(stats.alreadyInDb).toBe(0);
      expect(stats.distinctSessions).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('dedupes against existing prompt_hash in the DB', () => {
    const { root, cleanup } = setupFixtureRoot();
    const dbTmp = mkdtempSync(join(tmpdir(), 'tp-backfill-db-'));
    try {
      writeSessionFile(root, '-proj-b', 'session-2', [
        userEntry('session-2', '/proj/b', '2026-04-02T09:00:00.000Z', 'already imported'),
        userEntry('session-2', '/proj/b', '2026-04-02T09:05:00.000Z', 'brand new prompt'),
      ]);
      const db = openDb(dbTmp);
      upsertSession(db, { id: 'earlier-session', cwd: '/proj/b' });
      insertPromptUsage(db, { session_id: 'earlier-session', prompt_text: 'already imported' });

      const stats = scanClaudeHistory(db, { root });
      expect(stats.extractablePrompts).toBe(2);
      expect(stats.alreadyInDb).toBe(1);
      expect(stats.newPrompts).toBe(1);
      db.close();
    } finally {
      cleanup();
      rmSync(dbTmp, { recursive: true, force: true });
    }
  });

  it('honours --since and skips older prompts', () => {
    const { root, cleanup } = setupFixtureRoot();
    try {
      writeSessionFile(root, '-proj-c', 'session-3', [
        userEntry('session-3', '/proj/c', '2026-03-15T00:00:00.000Z', 'old prompt'),
        userEntry('session-3', '/proj/c', '2026-04-05T00:00:00.000Z', 'new enough prompt'),
      ]);
      const stats = scanClaudeHistory(null, { root, since: '2026-04-01' });
      expect(stats.extractablePrompts).toBe(1);
      expect(stats.skippedBySince).toBe(1);
      expect(stats.totalUserEntries).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('respects --limit on the number of files', () => {
    const { root, cleanup } = setupFixtureRoot();
    try {
      for (let i = 0; i < 5; i++) {
        writeSessionFile(root, `-proj-${i}`, `session-${i}`, [
          userEntry(`session-${i}`, `/p/${i}`, `2026-04-0${i + 1}T00:00:00.000Z`, `prompt ${i}`),
        ]);
      }
      const stats = scanClaudeHistory(null, { root, limit: 2 });
      expect(stats.filesScanned).toBe(2);
      expect(stats.extractablePrompts).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('filters by --project substring', () => {
    const { root, cleanup } = setupFixtureRoot();
    try {
      writeSessionFile(root, '-repo-alpha', 'session-a', [
        userEntry('session-a', '/repo/alpha', '2026-04-02T00:00:00.000Z', 'alpha'),
      ]);
      writeSessionFile(root, '-repo-beta', 'session-b', [
        userEntry('session-b', '/repo/beta', '2026-04-02T00:00:00.000Z', 'beta'),
      ]);
      const stats = scanClaudeHistory(null, { root, projectFilter: 'alpha' });
      expect(stats.filesScanned).toBe(1);
      expect(stats.extractablePrompts).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('extracts text from content-block arrays, not just strings', () => {
    const { root, cleanup } = setupFixtureRoot();
    try {
      writeSessionFile(root, '-proj-d', 'session-4', [
        userEntry('session-4', '/proj/d', '2026-04-10T00:00:00.000Z', [
          { type: 'text', text: 'multi' },
          { type: 'text', text: 'part' },
        ]),
      ]);
      const { prompts } = parseSessionFile(join(root, '-proj-d', 'session-4.jsonl'));
      expect(prompts).toHaveLength(1);
      expect(prompts[0]?.promptText).toBe('multi\npart');
    } finally {
      cleanup();
    }
  });

  it('skips malformed JSONL lines without failing the whole file', () => {
    const { root, cleanup } = setupFixtureRoot();
    try {
      const dir = join(root, '-proj-e');
      mkdirSync(dir, { recursive: true });
      const content = [
        JSON.stringify(userEntry('s5', '/proj/e', '2026-04-11T00:00:00.000Z', 'good')),
        '{ broken json',
        JSON.stringify(userEntry('s5', '/proj/e', '2026-04-12T00:00:00.000Z', 'also good')),
      ].join('\n');
      writeFileSync(join(dir, 'session-5.jsonl'), content, 'utf8');

      const stats = scanClaudeHistory(null, { root });
      expect(stats.filesFailed).toBe(0);
      expect(stats.extractablePrompts).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('tracks the earliest and latest timestamps across files', () => {
    const { root, cleanup } = setupFixtureRoot();
    try {
      writeSessionFile(root, '-p1', 's1', [
        userEntry('s1', '/p1', '2026-01-01T00:00:00.000Z', 'a'),
      ]);
      writeSessionFile(root, '-p2', 's2', [
        userEntry('s2', '/p2', '2026-06-30T00:00:00.000Z', 'b'),
      ]);
      const stats = scanClaudeHistory(null, { root });
      expect(stats.earliestTimestamp).toBe('2026-01-01T00:00:00.000Z');
      expect(stats.latestTimestamp).toBe('2026-06-30T00:00:00.000Z');
    } finally {
      cleanup();
    }
  });
});

describe('importClaudeHistory', () => {
  // A stub rules runner: flags anything with fewer than 10 chars as R001 sev 2.
  const stubRunRules: RunRulesFn = ({ promptText }) => {
    if (promptText.length < 10) {
      return [
        {
          ruleId: 'R001',
          ruleName: 'too_short',
          severity: 2,
          message: 'prompt is very short',
          evidence: null,
        },
      ];
    }
    return [];
  };

  it('imports each candidate into prompt_usages with original timestamp', () => {
    const { root, cleanup } = setupFixtureRoot();
    const dbTmp = mkdtempSync(join(tmpdir(), 'tp-import-'));
    try {
      writeSessionFile(root, '-proj-x', 'session-x', [
        userEntry('session-x', '/proj/x', '2026-02-01T10:00:00.000Z', 'first'),
        userEntry('session-x', '/proj/x', '2026-02-01T10:05:00.000Z', 'second prompt here'),
      ]);
      const db = openDb(dbTmp);
      const result = importClaudeHistory(db, { root, runRules: stubRunRules });
      expect(result.imported).toBe(2);
      expect(result.skippedDup).toBe(0);
      expect(result.distinctSessions).toBe(1);

      // Rows use the JSONL timestamp, not "now".
      const rows = db
        .prepare(`SELECT prompt_text, created_at FROM prompt_usages ORDER BY created_at ASC`)
        .all() as Array<{ prompt_text: string; created_at: string }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]?.created_at).toBe('2026-02-01T10:00:00.000Z');
      expect(rows[0]?.prompt_text).toBe('first');
      expect(rows[1]?.created_at).toBe('2026-02-01T10:05:00.000Z');
      db.close();
    } finally {
      cleanup();
      rmSync(dbTmp, { recursive: true, force: true });
    }
  });

  it('is idempotent — second run adds no new rows', () => {
    const { root, cleanup } = setupFixtureRoot();
    const dbTmp = mkdtempSync(join(tmpdir(), 'tp-import-'));
    try {
      writeSessionFile(root, '-proj-y', 'session-y', [
        userEntry('session-y', '/proj/y', '2026-03-01T09:00:00.000Z', 'only one'),
      ]);
      const db = openDb(dbTmp);
      const first = importClaudeHistory(db, { root, runRules: stubRunRules });
      expect(first.imported).toBe(1);

      const second = importClaudeHistory(db, { root, runRules: stubRunRules });
      expect(second.imported).toBe(0);
      expect(second.skippedDup).toBe(1);

      const cnt = db.prepare(`SELECT COUNT(*) AS c FROM prompt_usages`).get() as { c: number };
      expect(cnt.c).toBe(1);
      db.close();
    } finally {
      cleanup();
      rmSync(dbTmp, { recursive: true, force: true });
    }
  });

  it('runs rules and writes quality_scores + rule_hits', () => {
    const { root, cleanup } = setupFixtureRoot();
    const dbTmp = mkdtempSync(join(tmpdir(), 'tp-import-'));
    try {
      writeSessionFile(root, '-proj-z', 'session-z', [
        userEntry('session-z', '/proj/z', '2026-04-01T00:00:00.000Z', 'hi'),
      ]);
      const db = openDb(dbTmp);
      importClaudeHistory(db, { root, runRules: stubRunRules });

      const scores = db.prepare(`SELECT final_score, tier FROM quality_scores`).all() as Array<{
        final_score: number;
        tier: string;
      }>;
      expect(scores).toHaveLength(1);
      // Stub rule fires sev=2 -> rule_score = 100 - 5 = 95 -> tier 'good'.
      expect(scores[0]?.final_score).toBe(95);

      const hits = db.prepare(`SELECT rule_id FROM rule_hits`).all() as Array<{ rule_id: string }>;
      expect(hits).toHaveLength(1);
      expect(hits[0]?.rule_id).toBe('R001');
      db.close();
    } finally {
      cleanup();
      rmSync(dbTmp, { recursive: true, force: true });
    }
  });

  it('upserts the session row with source=claude-code-backfill', () => {
    const { root, cleanup } = setupFixtureRoot();
    const dbTmp = mkdtempSync(join(tmpdir(), 'tp-import-'));
    try {
      writeSessionFile(root, '-proj-w', 'session-w', [
        userEntry('session-w', '/proj/w', '2026-05-01T00:00:00.000Z', 'hello there'),
      ]);
      const db = openDb(dbTmp);
      importClaudeHistory(db, { root, runRules: stubRunRules });

      const session = db
        .prepare(`SELECT id, cwd, source FROM sessions WHERE id=?`)
        .get('session-w') as { id: string; cwd: string; source: string };
      expect(session.cwd).toBe('/proj/w');
      expect(session.source).toBe('claude-code-backfill');
      db.close();
    } finally {
      cleanup();
      rmSync(dbTmp, { recursive: true, force: true });
    }
  });

  it('reports progress via the callback', () => {
    const { root, cleanup } = setupFixtureRoot();
    const dbTmp = mkdtempSync(join(tmpdir(), 'tp-import-'));
    try {
      // 7 prompts split across 2 files.
      writeSessionFile(root, '-p-a', 'session-a', [
        userEntry('session-a', '/p/a', '2026-01-01T00:00:00.000Z', 'one'),
        userEntry('session-a', '/p/a', '2026-01-02T00:00:00.000Z', 'two'),
        userEntry('session-a', '/p/a', '2026-01-03T00:00:00.000Z', 'three'),
      ]);
      writeSessionFile(root, '-p-b', 'session-b', [
        userEntry('session-b', '/p/b', '2026-01-04T00:00:00.000Z', 'four'),
        userEntry('session-b', '/p/b', '2026-01-05T00:00:00.000Z', 'five'),
        userEntry('session-b', '/p/b', '2026-01-06T00:00:00.000Z', 'six'),
        userEntry('session-b', '/p/b', '2026-01-07T00:00:00.000Z', 'seven'),
      ]);
      const db = openDb(dbTmp);
      const calls: number[] = [];
      importClaudeHistory(db, {
        root,
        runRules: stubRunRules,
        batchSize: 3,
        onProgress: (p) => calls.push(p.processed),
      });
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[calls.length - 1]).toBe(7);
      db.close();
    } finally {
      cleanup();
      rmSync(dbTmp, { recursive: true, force: true });
    }
  });
});

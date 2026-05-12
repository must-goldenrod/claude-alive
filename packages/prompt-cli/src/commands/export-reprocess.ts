import { writeFileSync } from 'node:fs';
import {
  composeFinalScore,
  computeRuleScore,
  enqueue,
  getPaths,
  insertRuleHit,
  openDb,
  upsertQualityScore,
} from '@think-prompt/core';
import { runRules } from '@think-prompt/rules';
import pc from 'picocolors';

type SqliteParam = string | number | null | bigint | Buffer;

export async function exportCmd(opts: { since?: string; out: string }): Promise<void> {
  const db = openDb();
  let where = '';
  const args: SqliteParam[] = [];
  if (opts.since) {
    where = `WHERE created_at > datetime('now', ?)`;
    const s = opts.since.startsWith('-') ? opts.since : `-${opts.since}`;
    // Accept "30d" / "7d" etc.
    args.push(s.replace(/d$/, ' days').replace(/h$/, ' hours'));
  }
  const usages = db
    .prepare(`SELECT * FROM prompt_usages ${where} ORDER BY created_at DESC`)
    .all(...args) as Record<string, unknown>[];
  const scores = db.prepare(`SELECT * FROM quality_scores`).all() as Record<string, unknown>[];
  const hits = db.prepare(`SELECT * FROM rule_hits`).all() as Record<string, unknown>[];
  const sessions = db.prepare(`SELECT * FROM sessions`).all() as Record<string, unknown>[];
  const payload = {
    exported_at: new Date().toISOString(),
    usages,
    scores,
    hits,
    sessions,
  };
  writeFileSync(opts.out, JSON.stringify(payload, null, 2), 'utf8');
  console.log(pc.green('✓') + ` exported ${usages.length} usages to ${opts.out}`);
  db.close();
}

export async function reprocessCmd(opts: { session?: string; all?: boolean }): Promise<void> {
  const db = openDb();
  const paths = getPaths();
  const targets: {
    id: string;
    prompt_text: string;
    session_id: string;
    char_len: number;
    word_count: number;
    cwd: string;
  }[] = [];
  type ReprocessTarget = (typeof targets)[number];
  if (opts.all) {
    const rows = db
      .prepare(
        `SELECT pu.id, pu.prompt_text, pu.session_id, pu.char_len, pu.word_count, s.cwd
           FROM prompt_usages pu JOIN sessions s ON s.id = pu.session_id`
      )
      .all() as ReprocessTarget[];
    targets.push(...rows);
  } else if (opts.session) {
    const rows = db
      .prepare(
        `SELECT pu.id, pu.prompt_text, pu.session_id, pu.char_len, pu.word_count, s.cwd
           FROM prompt_usages pu JOIN sessions s ON s.id = pu.session_id
          WHERE pu.session_id = ?`
      )
      .all(opts.session) as ReprocessTarget[];
    targets.push(...rows);
  } else {
    console.log(pc.red('pass --all or --session <id>'));
    db.close();
    return;
  }
  let processed = 0;
  for (const t of targets) {
    // clear existing hits
    db.prepare(`DELETE FROM rule_hits WHERE usage_id=?`).run(t.id);
    const hits = runRules({
      promptText: t.prompt_text,
      session: { cwd: t.cwd },
      meta: { charLen: t.char_len, wordCount: t.word_count },
    });
    for (const h of hits) {
      insertRuleHit(db, {
        usage_id: t.id,
        rule_id: h.ruleId,
        severity: h.severity,
        message: h.message,
        evidence: h.evidence ?? undefined,
      });
    }
    const ruleScore = computeRuleScore(hits);
    const { final_score, tier } = composeFinalScore({
      rule_score: ruleScore,
      usage_score: null,
      judge_score: null,
    });
    upsertQualityScore(db, {
      usage_id: t.id,
      rule_score: ruleScore,
      final_score,
      tier,
      rules_version: 1,
    });
    processed++;
  }
  // Queue session transcript reparse for each session touched
  const sessionIds = [...new Set(targets.map((t) => t.session_id))];
  for (const sid of sessionIds) {
    const sess = db.prepare(`SELECT transcript_path FROM sessions WHERE id=?`).get(sid) as
      | { transcript_path: string | null }
      | undefined;
    if (sess?.transcript_path)
      enqueue(paths.queueFile, 'parse_transcript', {
        session_id: sid,
        transcript_path: sess.transcript_path,
      });
  }
  console.log(pc.green('✓') + ` reprocessed ${processed} prompts`);
  db.close();
}

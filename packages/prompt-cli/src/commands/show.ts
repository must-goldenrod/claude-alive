import { openDb } from '@think-prompt/core';
import pc from 'picocolors';

interface UsageRow {
  id: string;
  session_id: string;
  prompt_text: string;
  char_len: number;
  word_count: number;
  turn_index: number;
  created_at: string;
}
interface QualityScoreRow {
  rule_score: number;
  usage_score: number | null;
  judge_score: number | null;
  final_score: number;
  tier: string;
}
interface RuleHitRow {
  rule_id: string;
  severity: number;
  message: string;
}
type DbHandle = ReturnType<typeof openDb>;

function matchUsage(db: DbHandle, id: string): UsageRow | undefined {
  // Allow short suffix matching for convenience.
  if (id.length === 26)
    return db.prepare(`SELECT * FROM prompt_usages WHERE id=?`).get(id) as UsageRow | undefined;
  return db
    .prepare(`SELECT * FROM prompt_usages WHERE id LIKE ? ORDER BY created_at DESC LIMIT 1`)
    .get(`%${id}`) as UsageRow | undefined;
}

export async function showCmd(id: string): Promise<void> {
  const db = openDb();
  const u = matchUsage(db, id);
  if (!u) {
    console.log(pc.red('no matching prompt'));
    return;
  }
  const score = db.prepare(`SELECT * FROM quality_scores WHERE usage_id=?`).get(u.id) as
    | QualityScoreRow
    | undefined;
  const hits = db
    .prepare(`SELECT * FROM rule_hits WHERE usage_id=? ORDER BY severity DESC`)
    .all(u.id) as RuleHitRow[];

  console.log(pc.bold(`Prompt ${u.id}`));
  console.log(`  session: ${u.session_id}`);
  console.log(`  created: ${u.created_at}`);
  console.log(`  length:  ${u.char_len} chars, ${u.word_count} words, turn ${u.turn_index}`);
  console.log('');
  console.log(pc.dim('─── original ───'));
  console.log(u.prompt_text);
  console.log('');
  if (score) {
    console.log(
      `${pc.bold('score:')} rule=${score.rule_score} usage=${score.usage_score ?? '-'} judge=${score.judge_score ?? '-'} ` +
        `final=${pc.cyan(score.final_score)} tier=${score.tier}`
    );
  } else {
    console.log(pc.dim('no score yet'));
  }
  if (hits.length > 0) {
    console.log('');
    console.log(pc.bold('rule hits:'));
    for (const h of hits) {
      console.log(`  - ${pc.yellow(h.rule_id)} sev=${h.severity}: ${h.message}`);
    }
  }
  db.close();
}

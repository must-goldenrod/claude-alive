import { openDb } from '@think-prompt/core';
import pc from 'picocolors';

interface ListRow {
  id: string;
  session_id: string;
  snippet: string;
  created_at: string;
  final_score: number;
  tier: string;
  hits: number;
}

type SqliteParam = string | number | null;

export async function listCmd(opts: {
  limit?: string;
  tier?: string;
  rule?: string;
}): Promise<void> {
  const limit = Number.parseInt(opts.limit ?? '20', 10);
  const db = openDb();
  const wheres: string[] = [];
  const args: SqliteParam[] = [];
  if (opts.tier) {
    wheres.push('qs.tier = ?');
    args.push(opts.tier);
  }
  if (opts.rule) {
    wheres.push('EXISTS (SELECT 1 FROM rule_hits rh WHERE rh.usage_id = pu.id AND rh.rule_id = ?)');
    args.push(opts.rule);
  }
  const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT pu.id, pu.session_id, substr(pu.prompt_text, 1, 80) AS snippet, pu.created_at,
              COALESCE(qs.final_score, -1) AS final_score, COALESCE(qs.tier, 'n/a') AS tier,
              (SELECT COUNT(*) FROM rule_hits rh WHERE rh.usage_id = pu.id) AS hits
         FROM prompt_usages pu
         LEFT JOIN quality_scores qs ON qs.usage_id = pu.id
         ${where}
         ORDER BY pu.created_at DESC
         LIMIT ?`
    )
    .all(...args, limit) as ListRow[];
  if (rows.length === 0) {
    console.log(pc.dim('no prompts yet'));
    return;
  }
  for (const r of rows) {
    const tierColor: Record<string, (s: string) => string> = {
      good: pc.green,
      ok: pc.yellow,
      weak: pc.magenta,
      bad: pc.red,
      'n/a': pc.dim,
    };
    const color = tierColor[r.tier] ?? pc.white;
    const score = r.final_score >= 0 ? String(r.final_score).padStart(3) : ' - ';
    console.log(
      `${pc.dim(r.id.slice(-8))}  ${color(score)} ${color(r.tier.padEnd(4))}  ` +
        `${pc.dim(`hits:${String(r.hits).padStart(2)}`)}  ${r.snippet.replace(/\n/g, ' ')}`
    );
  }
  db.close();
}

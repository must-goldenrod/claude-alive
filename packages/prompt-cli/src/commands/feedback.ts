import { type OutcomeRating, openDb, recordOutcome } from '@think-prompt/core';
import pc from 'picocolors';

/**
 * `think-prompt feedback <usage_id> <up|down> [--note "..."]`
 *
 * Records a 👍 / 👎 for a prompt usage. Feedback feeds into usage_score
 * (25% weight when present) so tiers update after reprocess.
 */
export async function feedbackCmd(
  id: string,
  rating: string,
  opts: { note?: string }
): Promise<void> {
  if (rating !== 'up' && rating !== 'down') {
    console.log(pc.red('rating must be "up" or "down"'));
    return;
  }
  const db = openDb();
  const match = db
    .prepare(
      `SELECT id, substr(prompt_text, 1, 60) AS head FROM prompt_usages
         WHERE id = ? OR id LIKE ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(id, `%${id}`) as { id: string; head: string } | undefined;
  if (!match) {
    console.log(pc.red('no matching prompt'));
    db.close();
    return;
  }
  const outcome = recordOutcome(db, match.id, rating as OutcomeRating, opts.note);
  console.log(
    `${pc.green('✓')} ${rating === 'up' ? pc.green('👍') : pc.red('👎')} recorded for ${pc.dim(match.id.slice(-8))}`
  );
  console.log(pc.dim(`  ${match.head.replace(/\n/g, ' ')}`));
  console.log(
    pc.dim(
      `  (Run \`think-prompt reprocess --session <id>\` after a session ends to refresh usage_score.)`
    )
  );
  console.log(pc.dim(`  outcome id: ${outcome.id}`));
  db.close();
}

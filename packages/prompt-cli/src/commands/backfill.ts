/**
 * `think-prompt backfill` — scan / import historical user prompts from
 * `~/.claude/projects/**\/*.jsonl`.
 *
 * Modes:
 *   --dry-run (default) : count only, nothing written
 *   --execute           : transactional insert with rule scoring
 *
 * Common options:
 *   --limit N           : process at most N .jsonl files
 *   --since YYYY-MM-DD  : ignore prompts older than this date
 *   --project <substr>  : filter to project directories containing this
 *   --root <path>       : override the Claude projects directory
 */
import {
  type ImportProgress,
  importClaudeHistory,
  openDb,
  scanClaudeHistory,
} from '@think-prompt/core';
import { runRules } from '@think-prompt/rules';
import pc from 'picocolors';

export interface BackfillCmdOptions {
  dryRun?: boolean;
  execute?: boolean;
  limit?: string;
  since?: string;
  project?: string;
  root?: string;
  batchSize?: string;
}

interface ResolvedOptions {
  execute: boolean;
  limit: number;
  batchSize: number;
  since?: string;
  project?: string;
  root?: string;
}

export async function backfillCmd(opts: BackfillCmdOptions): Promise<void> {
  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : 0;
  if (opts.limit && (Number.isNaN(limit) || limit < 0)) {
    console.log(pc.red('✗') + ` invalid --limit value: ${opts.limit}`);
    process.exit(2);
  }
  const batchSize = opts.batchSize ? Number.parseInt(opts.batchSize, 10) : 500;
  if (opts.batchSize && (Number.isNaN(batchSize) || batchSize < 1)) {
    console.log(pc.red('✗') + ` invalid --batch-size value: ${opts.batchSize}`);
    process.exit(2);
  }

  const resolved: ResolvedOptions = {
    execute: opts.execute === true,
    limit,
    batchSize,
    ...(opts.since ? { since: opts.since } : {}),
    ...(opts.project ? { project: opts.project } : {}),
    ...(opts.root ? { root: opts.root } : {}),
  };

  if (resolved.execute) {
    await runExecute(resolved);
    return;
  }
  await runDryRun(resolved);
}

// ---------------------- dry-run ------------------------------------------

async function runDryRun(opts: ResolvedOptions): Promise<void> {
  let db: ReturnType<typeof openDb> | null = null;
  try {
    db = openDb();
  } catch (err) {
    console.log(
      pc.yellow('⚠') +
        ` could not open local DB (${(err as Error).message}); treating everything as new`
    );
  }

  const t0 = Date.now();
  console.log(pc.dim(`scanning ${opts.root ?? '~/.claude/projects'} ...`));
  const stats = scanClaudeHistory(db, {
    ...(opts.root ? { root: opts.root } : {}),
    ...(opts.limit > 0 ? { limit: opts.limit } : {}),
    ...(opts.since ? { since: opts.since } : {}),
    ...(opts.project ? { projectFilter: opts.project } : {}),
  });
  const ms = Date.now() - t0;
  if (db) db.close();

  if (!stats.rootExists) {
    console.log(pc.red('✗') + ` directory not found: ${stats.root}`);
    console.log('  Claude Code stores session transcripts under ~/.claude/projects/.');
    console.log(
      '  If you have never run Claude Code on this machine, there is nothing to backfill.'
    );
    process.exit(1);
    return;
  }

  console.log('');
  console.log(pc.bold(`Claude Code history scan  ${pc.dim(`(${ms} ms)`)}`));
  console.log('');
  printRow('root', stats.root);
  printRow('files scanned', stats.filesScanned.toLocaleString());
  printRow('files with user prompts', stats.filesWithPrompts.toLocaleString());
  if (stats.filesFailed > 0) {
    printRow('files failed to parse', pc.yellow(stats.filesFailed.toLocaleString()));
  }
  printRow('distinct sessions', stats.distinctSessions.toLocaleString());
  console.log('');
  printRow('total user entries', stats.totalUserEntries.toLocaleString());
  printRow('extractable prompts', stats.extractablePrompts.toLocaleString());
  if (stats.skippedBySince > 0) {
    printRow(`skipped by --since ${opts.since}`, stats.skippedBySince.toLocaleString());
  }
  console.log('');
  printRow('already in DB (dedup)', pc.dim(stats.alreadyInDb.toLocaleString()));
  printRow(
    'would be imported',
    stats.newPrompts > 0 ? pc.green(stats.newPrompts.toLocaleString()) : '0'
  );
  console.log('');
  if (stats.earliestTimestamp) {
    printRow('earliest timestamp', stats.earliestTimestamp);
    printRow('latest timestamp', stats.latestTimestamp ?? '');
  }
  console.log('');
  console.log(pc.dim('dry-run only — nothing was written.'));
  if (stats.newPrompts > 0) {
    console.log(
      pc.dim(
        `to import these ${stats.newPrompts.toLocaleString()} prompts: think-prompt backfill --execute`
      )
    );
  }
}

// ---------------------- execute ------------------------------------------

async function runExecute(opts: ResolvedOptions): Promise<void> {
  let db: ReturnType<typeof openDb>;
  try {
    db = openDb();
  } catch (err) {
    console.log(pc.red('✗') + ` could not open local DB (${(err as Error).message})`);
    process.exit(1);
    return;
  }

  console.log(pc.dim(`importing from ${opts.root ?? '~/.claude/projects'} ...`));
  const isTty = process.stdout.isTTY;
  const progressLine = (p: ImportProgress): string => {
    const pct = p.totalCandidates > 0 ? Math.floor((p.processed / p.totalCandidates) * 100) : 0;
    return `  ${pct.toString().padStart(3)}%  ${p.processed.toLocaleString()}/${p.totalCandidates.toLocaleString()}  imported ${p.imported.toLocaleString()}  failed ${p.failed.toLocaleString()}`;
  };

  const result = importClaudeHistory(db, {
    runRules,
    batchSize: opts.batchSize,
    ...(opts.root ? { root: opts.root } : {}),
    ...(opts.limit > 0 ? { limit: opts.limit } : {}),
    ...(opts.since ? { since: opts.since } : {}),
    ...(opts.project ? { projectFilter: opts.project } : {}),
    onProgress: (p) => {
      const line = progressLine(p);
      if (isTty) {
        // Overwrite previous progress line in place.
        process.stdout.write(`\r${line}\x1b[K`);
      } else {
        console.log(line);
      }
    },
  });

  if (isTty) process.stdout.write('\n');
  db.close();

  console.log('');
  console.log(pc.bold(`imported  ${pc.dim(`(${(result.durationMs / 1000).toFixed(1)} s)`)}`));
  console.log('');
  printRow('files scanned', result.filesScanned.toLocaleString());
  if (result.filesFailed > 0) {
    printRow('files failed', pc.yellow(result.filesFailed.toLocaleString()));
  }
  printRow('distinct sessions', result.distinctSessions.toLocaleString());
  printRow('candidates found', result.totalCandidates.toLocaleString());
  printRow('skipped (duplicates)', pc.dim(result.skippedDup.toLocaleString()));
  printRow('imported', result.imported > 0 ? pc.green(result.imported.toLocaleString()) : '0');
  if (result.failed > 0) {
    printRow('per-row failures', pc.yellow(result.failed.toLocaleString()));
  }
  console.log('');
  console.log(pc.dim('open the claude-alive Prompt tab to see the new rows'));
}

function printRow(label: string, value: string): void {
  const pad = 28;
  const key = label.padEnd(pad);
  console.log(`  ${pc.dim(key)}${value}`);
}

/**
 * CLI for the offline gate-vs-Jev replay (`node dist/jev/replayCli.js`).
 *
 * Reads the stored evaluation records, asks Jev the gate's question about each,
 * and prints the three-way table (gate / Jev / human) plus a threshold sweep. It
 * writes the raw rows to disk so the sweep can be redone without paying for the
 * calls again.
 *
 * Read-only with respect to everything the server owns: it opens
 * `evaluations.json` for reading and writes only its own output file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadServerEnv } from '../serverEnv.js';
import { parsePanelExcludedRoots } from '../panel/panelPolicy.js';
import { jevClientFromEnv } from './client.js';
import {
  DEFAULT_THRESHOLDS,
  bestThreshold,
  replayAll,
  selectReplayable,
  sweepThresholds,
  tallyAt,
  type ReplayRecord,
  type ReplayRow,
} from './replay.js';

/**
 * Pinned, not `jev-latest`.
 *
 * A measurement compared against a floating alias is not a measurement: an
 * upstream version bump would move the numbers with nothing in the repo
 * changing. The live path may float; this one states which model produced the
 * table. `JEV_MODEL` still overrides for a deliberate re-measurement.
 */
const MEASUREMENT_JEV_MODEL = 'jev-1.13.0';

const EVALUATIONS_FILE = process.env.CA_EVAL_FILE ?? join(homedir(), '.claude-alive', 'evaluations.json');
const OUTPUT_FILE = process.env.CA_JEV_REPLAY_OUT ?? join(homedir(), '.claude-alive', 'jev-replay.json');

function readRecords(path: string): ReplayRecord[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (!Array.isArray(parsed)) throw new Error(`${path} is not an array of records`);
  return parsed as ReplayRecord[];
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

/** Gate precision against human labels — the number this replay is compared to. */
function gateBaseline(rows: readonly ReplayRow[]): string[] {
  const judged = rows.filter((r) => r.human !== null);
  const passJudged = judged.filter((r) => r.gate === 'pass');
  const failJudged = judged.filter((r) => r.gate === 'fail');
  const passGood = passJudged.filter((r) => r.human === 'good').length;
  const failBad = failJudged.filter((r) => r.human === 'bad').length;
  return [
    `gate PASS precision: ${passGood}/${passJudged.length} (${pct(passGood, passJudged.length)})`,
    `gate FAIL precision: ${failBad}/${failJudged.length} (${pct(failBad, failJudged.length)})`,
    `inconclusive replayed: ${rows.filter((r) => r.gate === 'inconclusive').length}`,
  ];
}

function sweepTable(rows: readonly ReplayRow[]): string {
  const header =
    '| thr | judged | ✓pass | ✗pass | ✓fail | ✗fail | agree | balanced | gate오경보회피 | gate누락포착 |';
  const divider = '|---|---|---|---|---|---|---|---|---|---|';
  const lines = sweepThresholds(rows, [...DEFAULT_THRESHOLDS]).map(
    (t) =>
      `| ${t.threshold} | ${t.judged} | ${t.truePass} | ${t.falsePass} | ${t.trueFail} | ${t.falseFail} | ` +
      `${(t.agreementWithHuman * 100).toFixed(1)}% | ${(t.balancedAccuracy * 100).toFixed(1)}% | ` +
      `${t.gateFalseAlarmsJevAvoided} | ${t.gateMissesJevCaught} |`,
  );
  return [header, divider, ...lines].join('\n');
}

/** The rows a reader will want to open by hand: gate and Jev on opposite sides. */
function disagreements(rows: readonly ReplayRow[], threshold: number): string[] {
  return rows
    .filter((r) => r.human !== null)
    .filter((r) => (r.gate === 'pass') !== r.noul >= threshold)
    .map(
      (r) =>
        `  ${r.ticketId}  gate=${r.gate}  jev=${r.noul.toFixed(3)}  coverage=${r.coverage.toFixed(2)}  human=${r.human}`,
    );
}

async function main(): Promise<void> {
  loadServerEnv();
  const client = jevClientFromEnv({ JEV_MODEL: MEASUREMENT_JEV_MODEL, ...process.env });
  if (!client) {
    console.error('TYPESAFE_API_KEY is not set (looked in the process env and ~/.claude-alive/.env).');
    process.exit(1);
  }

  const all = readRecords(EVALUATIONS_FILE);
  const excludedRoots = parsePanelExcludedRoots(process.env);
  const limit = Number(process.env.CA_JEV_REPLAY_LIMIT ?? '0');
  let records = selectReplayable(all, excludedRoots);
  const withheld = all.filter((r) => !records.includes(r)).length;
  if (limit > 0) records = records.slice(-limit);

  console.log(`records: ${all.length} total, ${records.length} replayable${limit > 0 ? ` (limited to ${limit})` : ''}`);
  console.log(
    excludedRoots.length > 0
      ? `panel policy: ${excludedRoots.length} excluded root(s), ${withheld} record(s) withheld from the API`
      : 'panel policy: no excluded roots configured (CLAUDE_ALIVE_PANEL_EXCLUDE)',
  );
  console.log(`model: ${client.model}`);

  const started = Date.now();
  const { rows, errors, inputTokens, clipped } = await replayAll(client, records, {
    concurrency: Number(process.env.CA_JEV_REPLAY_CONCURRENCY ?? '4'),
    onProgress: ({ done, total }) => {
      if (done % 25 === 0 || done === total) console.log(`  ${done}/${total}`);
    },
  });
  const elapsed = (Date.now() - started) / 1000;

  console.log('');
  console.log(`rows: ${rows.length}, errors: ${errors.length}, ${elapsed.toFixed(1)}s`);
  console.log(`input tokens: ${inputTokens} → $${((inputTokens / 1_000_000) * 0.042).toFixed(4)} (output is free)`);
  console.log(`clipped to fit the caps: ${clipped}`);
  console.log('');
  for (const line of gateBaseline(rows)) console.log(line);
  console.log('');
  console.log(sweepTable(rows));

  // Balanced accuracy, not agreement: see bestThreshold(). 50% is the coin flip.
  const best = bestThreshold(rows, [...DEFAULT_THRESHOLDS]);
  console.log('');
  if (best === null) {
    console.log('no usable threshold: the human labelled only one class, so nothing here separates anything.');
  } else {
    console.log(
      `best balanced accuracy at thr=${best.threshold}: ${(best.balancedAccuracy * 100).toFixed(1)}% ` +
        `(50% = coin flip; agreement at that cut ${(best.agreementWithHuman * 100).toFixed(1)}%)`,
    );
    console.log(`disagreements with the gate at thr=${best.threshold}:`);
    for (const line of disagreements(rows, best.threshold).slice(0, 40)) console.log(line);
  }

  if (errors.length > 0) {
    console.log('');
    console.log('errors:');
    for (const e of errors.slice(0, 10)) console.log(`  ${e.ticketId}: ${e.error}`);
  }

  writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: client.model,
        inputTokens,
        clipped,
        excludedRoots,
        rows,
        errors,
        tally: best === null ? null : tallyAt(rows, best.threshold),
      },
      null,
      2,
    ),
  );
  console.log('');
  console.log(`raw rows → ${OUTPUT_FILE}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

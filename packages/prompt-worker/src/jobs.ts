import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  composeFinalScore,
  computeConfidence,
  computeUsageScore,
  createLogger,
  finishSubagent,
  llm,
  loadBaseline,
  loadConfig,
  openDb,
  refreshBaseline,
  transcript as tp,
  ulid,
  updateUsageEfficiencyFeatures,
  upsertQualityScore,
} from '@think-prompt/core';

const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;

// db returned by openDb; logger returned by createLogger — both typed implicitly.
export interface JobContext {
  db: ReturnType<typeof openDb>;
  logger: ReturnType<typeof createLogger>;
  config: ReturnType<typeof loadConfig>;
  rootOverride?: string | undefined;
}

function safeReadFile(path: string, maxBytes: number): string | null {
  if (!existsSync(path)) return null;
  const size = statSync(path).size;
  if (size <= maxBytes) return readFileSync(path, 'utf8');
  // tail
  const { openSync, readSync, closeSync } = require('node:fs') as typeof import('node:fs');
  const fd = openSync(path, 'r');
  try {
    const start = size - maxBytes;
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export async function handleParseSubagentTranscript(
  ctx: JobContext,
  payload: { session_id: string; agent_id: string; agent_transcript_path: string }
): Promise<'done' | 'retry'> {
  const text = safeReadFile(payload.agent_transcript_path, MAX_TRANSCRIPT_BYTES);
  if (text == null) {
    // Transcript file no longer exists. Retrying will never succeed and just
    // floods the DLQ — log the loss and move on so we don't block other jobs.
    // The subagent row stays in whatever state it was; downstream UI tolerates
    // it (status remains as last set by upsertSubagent).
    ctx.logger.warn(
      {
        session_id: payload.session_id,
        agent_id: payload.agent_id,
        path: payload.agent_transcript_path,
      },
      'subagent transcript missing — dropping job'
    );
    return 'done';
  }
  // Parse + DB writes wrapped: any deterministic failure (malformed JSONL,
  // schema drift, FK constraint on closed session) is permanent, so retrying
  // would just feed the DLQ. Log and drop.
  try {
    const events = tp.parseTranscriptString(text);
    const prompt_text = tp.extractFirstUserPrompt(events);
    const response_text = tp.extractFinalAssistantText(events);
    finishSubagent(ctx.db, payload.session_id, payload.agent_id, {
      prompt_text,
      response_text,
      transcript_path: payload.agent_transcript_path,
    });
    ctx.logger.info(
      { session_id: payload.session_id, agent_id: payload.agent_id, events: events.length },
      'subagent transcript parsed'
    );
  } catch (err) {
    ctx.logger.warn(
      {
        err,
        session_id: payload.session_id,
        agent_id: payload.agent_id,
        path: payload.agent_transcript_path,
      },
      'subagent transcript parse/persist failed — dropping job'
    );
  }
  return 'done';
}

export async function handleParseTranscript(
  ctx: JobContext,
  payload: { session_id: string; transcript_path: string }
): Promise<'done' | 'retry'> {
  const text = safeReadFile(payload.transcript_path, MAX_TRANSCRIPT_BYTES);
  if (text == null) {
    ctx.logger.warn(
      { session_id: payload.session_id, path: payload.transcript_path },
      'session transcript missing — dropping job'
    );
    return 'done';
  }
  let events: ReturnType<typeof tp.parseTranscriptString>;
  let toolSummary: ReturnType<typeof tp.summarizeToolUse>;
  try {
    events = tp.parseTranscriptString(text);
    toolSummary = tp.summarizeToolUse(events);
  } catch (err) {
    ctx.logger.warn(
      { err, session_id: payload.session_id, path: payload.transcript_path },
      'session transcript parse failed — dropping job'
    );
    return 'done';
  }

  // Compute usage scores per prompt_usage in this session
  const usages = ctx.db
    .prepare(
      `SELECT id, prompt_hash, turn_index FROM prompt_usages WHERE session_id = ? ORDER BY turn_index ASC`
    )
    .all(payload.session_id) as Array<{ id: string; prompt_hash: string; turn_index: number }>;

  const totalCalls = toolSummary.reduce((a, b) => a + b.calls, 0);
  const rollup = ctx.db
    .prepare(
      `SELECT SUM(call_count) as calls, SUM(fail_count) as fails FROM tool_use_rollups WHERE session_id=?`
    )
    .get(payload.session_id) as { calls: number | null; fails: number | null };
  const calls = rollup.calls ?? totalCalls;
  const fails = rollup.fails ?? 0;

  // D-046 §3.4.1: extract per-turn efficiency features from the transcript.
  // Zipped positionally against usages[] in their turn_index order. When the
  // counts disagree (e.g. transcript clipped) we fall back to nulls for the
  // overflow — the scorer treats missing efficiency as "not present" and
  // renormalizes remaining weights.
  const turnFeatures = tp.extractTurnEfficiency(events);

  // Current baseline (may be null during cold-start).
  const baseline = loadBaseline(ctx.db);

  for (let i = 0; i < usages.length; i++) {
    const u = usages[i]!;
    const tf = turnFeatures[i];
    const hashSeenBefore = ctx.db
      .prepare(
        `SELECT COUNT(*) AS c FROM prompt_usages WHERE prompt_hash=? AND session_id=? AND id < ?`
      )
      .get(u.prompt_hash, payload.session_id, u.id) as { c: number };
    const fb = ctx.db
      .prepare(
        `SELECT
            SUM(CASE WHEN rating='up' THEN 1 ELSE 0 END) AS ups,
            SUM(CASE WHEN rating='down' THEN 1 ELSE 0 END) AS downs
           FROM outcomes WHERE usage_id = ?`
      )
      .get(u.id) as { ups: number | null; downs: number | null };

    // Persist per-turn efficiency features on prompt_usages so downstream
    // re-scoring and dashboards can pick them up without reparsing.
    if (tf) {
      updateUsageEfficiencyFeatures(ctx.db, u.id, {
        first_shot_success: tf.firstShotSuccess,
        tool_call_count: tf.toolCalls,
        follow_up_depth: tf.followUpDepth,
      });
    }

    const usageScore = computeUsageScore({
      toolCalls: calls,
      toolFails: fails,
      reuseCount: hashSeenBefore.c,
      responseLength: 0, // unknown per-usage without deeper correlation
      feedbackUps: fb.ups ?? 0,
      feedbackDowns: fb.downs ?? 0,
      firstShotSuccess: tf?.firstShotSuccess ?? null,
      turnToolCallCount: tf?.toolCalls ?? null,
      followUpDepth: tf?.followUpDepth ?? null,
    });

    const existing = ctx.db
      .prepare(`SELECT rule_score, judge_score FROM quality_scores WHERE usage_id=?`)
      .get(u.id) as { rule_score: number; judge_score: number | null } | undefined;
    if (!existing) continue;

    // D-046: feed the asymmetric cap input (max severity + severity-3 count).
    const sev = ctx.db
      .prepare(
        `SELECT COALESCE(MAX(severity),0) AS maxsev,
                SUM(CASE WHEN severity=3 THEN 1 ELSE 0 END) AS sev3
           FROM rule_hits WHERE usage_id=?`
      )
      .get(u.id) as { maxsev: number; sev3: number | null };

    const {
      final_score,
      tier,
      cap,
      bonus: appliedBonus,
    } = composeFinalScore({
      rule_score: existing.rule_score,
      usage_score: usageScore,
      judge_score: existing.judge_score ?? null,
      maxSeverity: sev.maxsev,
      severity3Count: sev.sev3 ?? 0,
    });

    // D-046 §6 confidence. baseline_delta is null during cold-start — the
    // computeConfidence helper treats null as "not a low-confidence signal".
    const baselineDelta = baseline ? Math.round(final_score - baseline.avg_final_score) : null;
    const confidence = computeConfidence({
      maxSeverity: sev.maxsev,
      hasUsageScore: usageScore != null,
      hasJudgeScore: existing.judge_score != null,
      baselineDelta,
    });

    upsertQualityScore(ctx.db, {
      usage_id: u.id,
      rule_score: existing.rule_score,
      usage_score: usageScore,
      judge_score: existing.judge_score ?? null,
      final_score,
      tier,
      rules_version: 1,
      efficiency_score: tf
        ? Math.round(
            (tf.firstShotSuccess ? 60 : 0) +
              (tf.toolCalls <= 3 ? 27 : tf.toolCalls <= 8 ? 22 : 7) +
              (tf.followUpDepth <= 1 ? 10 : tf.followUpDepth === 2 ? 7 : 4)
          )
        : null,
      bonus_score: appliedBonus ?? 0,
      cap_applied: cap ?? null,
      confidence,
      baseline_delta: baselineDelta,
    });
  }

  // D-046 §5: refresh baseline snapshot once per transcript parse. Cheap
  // (~one aggregate query) and keeps delta fresh without a separate cron.
  refreshBaseline(ctx.db);

  ctx.logger.info(
    { session_id: payload.session_id, events: events.length, usages: usages.length },
    'session transcript parsed & rescored'
  );
  return 'done';
}

export async function handleSessionEnd(
  ctx: JobContext,
  payload: { session_id: string }
): Promise<'done' | 'retry'> {
  // Enqueue judge jobs for LOW-CONFIDENCE prompts in this session (D-046 §4.1).
  // The old `final_score < threshold` trigger is kept as a fallback so scoring
  // for pre-D-046 rows (where confidence is still NULL) still benefits from
  // judge review.
  if (!ctx.config.llm.enabled) return 'done';
  const apiKey = process.env[ctx.config.llm.api_key_env];
  if (!apiKey) return 'done';
  const rows = ctx.db
    .prepare(
      `SELECT q.usage_id
         FROM quality_scores q
         JOIN prompt_usages u ON u.id = q.usage_id
        WHERE u.session_id = ?
          AND q.judge_score IS NULL
          AND (q.confidence = 'low' OR (q.confidence IS NULL AND q.final_score < ?))`
    )
    .all(payload.session_id, ctx.config.llm.judge_threshold_score) as Array<{ usage_id: string }>;

  if (rows.length === 0) return 'done';
  const { enqueue } = await import('@think-prompt/core');
  const { getPaths } = await import('@think-prompt/core');
  const paths = getPaths(ctx.rootOverride);
  for (const r of rows.slice(0, 5)) {
    enqueue(paths.queueFile, 'judge', { usage_id: r.usage_id });
  }
  ctx.logger.info({ session_id: payload.session_id, enqueued: rows.length }, 'judge jobs queued');
  return 'done';
}

/**
 * Judge system prompt v2 — criterion-aware (docs/08-quality-criteria.md).
 *
 * The judge now flags specific C-IDs that a rule-based engine cannot easily
 * detect (rambling, intent-singularity, appropriateness of examples, mixed
 * language, cold-start context, etc.). Return schema stays strict so it can
 * survive prompt caching + parsing.
 */
const JUDGE_SYSTEM = `You are a precise prompt-quality auditor for developer workflows with Claude Code.

You evaluate a user-typed prompt along 5 axes (scored 0-100 total):
- clarity   (25) — is the intent unambiguous?
- context   (25) — is there enough project/domain/environment detail?
- output    (20) — is output format / length / language explicit?
- focus     (15) — one focused task, not a stack of asks?
- criteria  (15) — is "done" defined?

You ALSO check for criterion-level problems we track in our registry. Only
include an id if you're confident. Valid ids:
  C-003 rambling — long and drifts between topics
  C-005 bad_section_order — meta sections scrambled
  C-006 question_command_mix — questions and imperatives tangled
  C-019 tone_unspecified — a non-trivial output but tone/register unset
  C-021 example_mismatch — example present but inconsistent with ask
  C-027 intent_not_single — two or more distinct goals
  C-030 grammar_errors — grammar hampers understanding
  C-033 over_politeness — burying the ask in excessive hedging
  C-044 prev_turn_anchor_weak — relies on earlier turn we cannot see
  C-045 cold_start_missing — first turn, assumes unseen context
  C-046 vague_reedit — "no redo it" style without specifics
  C-048 mixed_language_bad — unnatural ko/en mixing hurting clarity
  C-056 claude_mistake — pattern Claude specifically handles poorly

Return STRICT JSON only, no prose, no code fences:
{
  "score": <0-100>,
  "axes": {"clarity":<0-25>,"context":<0-25>,"output":<0-20>,"focus":<0-15>,"criteria":<0-15>},
  "top_issue": "<one sentence>",
  "fix_hint": "<one actionable sentence>",
  "criterion_hits": ["C-003", ...]
}`;

export async function handleJudge(
  ctx: JobContext,
  payload: { usage_id: string }
): Promise<'done' | 'retry'> {
  if (!ctx.config.llm.enabled) return 'done';
  const apiKey = process.env[ctx.config.llm.api_key_env];
  if (!apiKey) return 'done';
  const u = ctx.db
    .prepare(`SELECT pii_masked, prompt_text, char_len FROM prompt_usages WHERE id=?`)
    .get(payload.usage_id) as
    | { pii_masked: string; prompt_text: string; char_len: number }
    | undefined;
  if (!u) return 'done';
  const existing = ctx.db
    .prepare(`SELECT rule_score, usage_score, judge_score FROM quality_scores WHERE usage_id=?`)
    .get(payload.usage_id) as
    | { rule_score: number; usage_score: number | null; judge_score: number | null }
    | undefined;
  if (!existing) return 'done';
  if (existing.judge_score != null) return 'done';

  const body = `[PROMPT]\n${u.pii_masked}\n[CONTEXT]\nchar_len: ${u.char_len}\n[END]`;
  try {
    const res = await llm.anthropicMessage({
      apiKey,
      model: ctx.config.llm.model,
      system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: body }],
      maxTokens: 300,
      cacheSystem: true,
    });
    const parsed = llm.parseStrictJson<{
      score: number;
      top_issue?: string;
      fix_hint?: string;
      criterion_hits?: string[];
    }>(res.text);
    if (!parsed || typeof parsed.score !== 'number') {
      ctx.logger.warn(
        { usage_id: payload.usage_id, text: res.text.slice(0, 200) },
        'judge parse failed'
      );
      return 'done';
    }
    const judgeScore = Math.max(0, Math.min(100, Math.round(parsed.score)));

    // Persist criterion_hits as synthetic rule_hits with a J- prefix. They
    // are NOT counted in the deterministic rule_score (composer keeps the
    // rule vs. judge weight split intact) but DO show up in the dashboard
    // so the user can see judge-level findings.
    if (Array.isArray(parsed.criterion_hits)) {
      for (const cid of parsed.criterion_hits) {
        if (typeof cid !== 'string' || !cid.startsWith('C-')) continue;
        ctx.db
          .prepare(
            `INSERT OR IGNORE INTO rule_hits(usage_id, rule_id, severity, message, evidence)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            payload.usage_id,
            `J-${cid}`,
            2,
            parsed.top_issue ?? `LLM judge flagged ${cid}`,
            parsed.fix_hint ?? null
          );
      }
    }
    const { final_score, tier } = composeFinalScore({
      rule_score: existing.rule_score,
      usage_score: existing.usage_score,
      judge_score: judgeScore,
    });
    upsertQualityScore(ctx.db, {
      usage_id: payload.usage_id,
      rule_score: existing.rule_score,
      usage_score: existing.usage_score,
      judge_score: judgeScore,
      final_score,
      tier,
      rules_version: 1,
    });
    ctx.db
      .prepare(`INSERT INTO audit(id, ts, action, actor, detail) VALUES (?,?,?,?,?)`)
      .run(
        ulid(),
        new Date().toISOString(),
        'judge.ok',
        'worker',
        JSON.stringify({ usage_id: payload.usage_id, judge_score: judgeScore, usage: res.usage })
      );
    return 'done';
  } catch (err) {
    ctx.logger.error({ err }, 'judge failed');
    return 'retry';
  }
}

export type JobHandler = (ctx: JobContext, payload: unknown) => Promise<'done' | 'retry'>;
export const HANDLERS: Record<string, JobHandler> = {
  parse_subagent_transcript: handleParseSubagentTranscript as JobHandler,
  parse_transcript: handleParseTranscript as JobHandler,
  session_end: handleSessionEnd as JobHandler,
  judge: handleJudge as JobHandler,
};

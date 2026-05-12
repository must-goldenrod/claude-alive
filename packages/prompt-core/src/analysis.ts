/**
 * Deep analysis — the consent-gated LLM call that turns one prompt into a
 * structured problem diagnosis + step-by-step reasoning + suggested rewrite.
 *
 * Flow:
 *   1. Load the usage row from DB (or throw).
 *   2. Call Anthropic with a structured JSON-only system prompt.
 *   3. Validate the JSON shape; on parse failure fall back to a "failed"
 *      deep_analyses row with the error message so the UI can show it.
 *   4. Insert into `deep_analyses` (always — success OR failed) so the
 *      audit trail captures both outcomes.
 *
 * PII: the caller is expected to pass `pii_masked` text, not raw. That's
 * enforced by `runDeepAnalysis` preferring `pii_masked` over `prompt_text`
 * whenever the masked copy is non-empty.
 *
 * See docs/00-decision-log.md D-015 (LLM SDK), D-033 (deep analysis
 * consent policy).
 */
import type { Database as Db } from 'better-sqlite3';
import { type DeepAnalysisProblem, type DeepAnalysisRow, insertDeepAnalysis } from './db.js';
import { anthropicMessage, parseStrictJson } from './llm/anthropic.js';

const DEEP_SYSTEM: string = `You analyse Claude Code user prompts and return a structured diagnosis.

Your job has three parts:
  1. Identify problems in the prompt (ambiguity, missing context, wrong output
     format, multi-task confusion, etc.). Up to 5 problems.
  2. Provide step-by-step reasoning for how to improve it — narrative sentences
     the user can read as a learning artefact, NOT just bullet rule ids.
     3-6 steps.
  3. Produce a single improved rewrite that preserves the user's intent.

Rules:
  - Preserve the original language: Korean -> Korean, English -> English,
    mixed -> mixed.
  - Do NOT invent facts or add constraints the user did not imply.
  - Do NOT leak any masked tokens (<<EMAIL>>, <<API_KEY>>, ...) in the
    rewrite — keep them as-is.
  - Return STRICT JSON only. No prose before or after the JSON object.

Schema:
{
  "problems": [
    {
      "category": "ambiguity" | "missing_context" | "no_output_format" |
                  "multi_task" | "too_short" | "style" | "other",
      "severity": 1 | 2 | 3 | 4 | 5,
      "explanation": "1-2 sentences, user-facing"
    }
  ],
  "reasoning": [
    "Step 1 narrative ...",
    "Step 2 narrative ...",
    "..."
  ],
  "after_text": "<improved prompt, full text>",
  "applied_fixes": ["R001", "R003", ...]
}`;

export interface RunDeepAnalysisInput {
  usage_id: string;
  apiKey: string;
  model: string;
}

export interface RunDeepAnalysisResult extends DeepAnalysisRow {
  /** True when the LLM returned parseable JSON. */
  ok: boolean;
}

/**
 * Run a single deep analysis and persist the result. Never throws —
 * returns a `failed` row on any error so the UI can render it.
 */
export async function runDeepAnalysis(
  db: Db,
  input: RunDeepAnalysisInput
): Promise<RunDeepAnalysisResult> {
  const usage = db
    .prepare(`SELECT id, prompt_text, pii_masked FROM prompt_usages WHERE id=?`)
    .get(input.usage_id) as
    | { id: string; prompt_text: string; pii_masked: string | null }
    | undefined;
  if (!usage) {
    const row = insertDeepAnalysis(db, {
      usage_id: input.usage_id,
      model: input.model,
      status: 'failed',
      problems: [],
      reasoning: [],
      after_text: '',
      error_message: 'prompt_usage not found',
    });
    return { ok: false, ...row };
  }

  const promptForLlm =
    usage.pii_masked && usage.pii_masked.length > 0 ? usage.pii_masked : usage.prompt_text;

  const hits = db
    .prepare(`SELECT rule_id, severity, message FROM rule_hits WHERE usage_id=?`)
    .all(usage.id) as Array<{ rule_id: string; severity: number; message: string }>;

  const userBody = [
    '[ORIGINAL PROMPT]',
    promptForLlm,
    '',
    '[DETECTED ISSUES]',
    hits.length === 0
      ? '(no rule hits)'
      : hits.map((h) => `- ${h.rule_id} (sev ${h.severity}): ${h.message}`).join('\n'),
    '[END]',
  ].join('\n');

  try {
    const res = await anthropicMessage({
      apiKey: input.apiKey,
      model: input.model,
      system: DEEP_SYSTEM,
      messages: [{ role: 'user', content: userBody }],
      maxTokens: 1400,
      cacheSystem: true,
    });

    const parsed = parseStrictJson<{
      problems?: Array<Partial<DeepAnalysisProblem>>;
      reasoning?: string[];
      after_text?: string;
      applied_fixes?: string[];
    }>(res.text);

    if (!parsed || typeof parsed.after_text !== 'string' || parsed.after_text.length === 0) {
      const row = insertDeepAnalysis(db, {
        usage_id: usage.id,
        model: input.model,
        status: 'failed',
        problems: [],
        reasoning: [],
        after_text: '',
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        error_message: `LLM returned invalid JSON: ${res.text.slice(0, 200)}`,
      });
      return { ok: false, ...row };
    }

    const problems: DeepAnalysisProblem[] = Array.isArray(parsed.problems)
      ? parsed.problems.flatMap((p) => {
          if (!p || typeof p.explanation !== 'string') return [];
          return [
            {
              category: typeof p.category === 'string' ? p.category : 'other',
              severity: clampSeverity(p.severity ?? 2),
              explanation: p.explanation,
            },
          ];
        })
      : [];
    const reasoning: string[] = Array.isArray(parsed.reasoning)
      ? parsed.reasoning.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : [];
    const appliedFixes: string[] = Array.isArray(parsed.applied_fixes)
      ? parsed.applied_fixes.filter((s): s is string => typeof s === 'string')
      : [];

    const row = insertDeepAnalysis(db, {
      usage_id: usage.id,
      model: input.model,
      status: 'ok',
      problems,
      reasoning,
      after_text: parsed.after_text,
      applied_fixes: appliedFixes,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
    });
    return { ok: true, ...row };
  } catch (err) {
    const row = insertDeepAnalysis(db, {
      usage_id: usage.id,
      model: input.model,
      status: 'failed',
      problems: [],
      reasoning: [],
      after_text: '',
      error_message: (err as Error).message.slice(0, 500),
    });
    return { ok: false, ...row };
  }
}

function clampSeverity(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return 2;
  return Math.min(5, Math.max(1, Math.round(n)));
}

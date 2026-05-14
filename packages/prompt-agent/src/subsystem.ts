/**
 * Prompt subsystem — the absorbed think-prompt capture pipeline as an
 * in-process library, not a standalone daemon.
 *
 * Returned shape:
 *   - ingest(payload)  : unified hook dispatcher called from claude-alive's
 *                         `/api/event` handler. One entry point per Claude
 *                         Code hook event; replaces the legacy /v1/hook/*
 *                         Fastify routes.
 *   - fastify          : Fastify instance exposing read-only JSON API
 *                         (/api/prompts*, /api/sessions*) plus the browser
 *                         extension ingest (/v1/ingest/web). Mounted onto
 *                         claude-alive's shared http.Server — never opens
 *                         its own port.
 *   - close()          : releases the SQLite handle on shutdown.
 *
 * The coaching-hint response (D-021) is *not* preserved on the unified
 * path: claude-alive's bash hook discards the POST response, so there is
 * no channel to feed `hookSpecificOutput.additionalContext` back to Claude
 * Code. If we want coaching restored we need a different hook transport
 * (e.g. an `http`-type Claude Code hook, not a `command` wrapper).
 */
import {
  type Config,
  WebIngestPayload,
  bumpToolRollup,
  createLogger,
  endSession,
  enqueue,
  finishSubagent,
  getPaths,
  insertPromptUsage,
  insertRuleHit,
  loadConfig,
  openDb,
  upsertSession,
  upsertSubagent,
  upsertQualityScore,
} from '@think-prompt/core';
import { composeFinalScore, computeRuleScore } from '@think-prompt/core';
import { runRules } from '@think-prompt/rules';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HookEventPayload } from '@claude-alive/core';

export interface PromptSubsystemDeps {
  config?: Config;
  rootOverride?: string;
}

export interface PromptSubsystem {
  ingest: (payload: HookEventPayload) => void;
  fastify: FastifyInstance;
  close: () => void;
}

export function createPromptSubsystem(deps: PromptSubsystemDeps = {}): PromptSubsystem {
  const config = deps.config ?? loadConfig(deps.rootOverride);
  const paths = getPaths(deps.rootOverride);
  const logger = createLogger('prompt', { file: paths.agentLog, stdout: false });
  const db = openDb(deps.rootOverride);

  // ---------------------------------------------------------------------
  // Unified ingest — one synchronous dispatcher per Claude Code hook.
  // Errors are swallowed (fail-open) so a malformed payload never blocks
  // the upstream UI fan-out. Detailed traces go to the prompt log.
  // ---------------------------------------------------------------------
  function ingest(payload: HookEventPayload): void {
    const data = payload.data as HookEventPayload['data'] & {
      model?: string;
      agent_transcript_path?: string;
    };
    const sessionId = payload.session_id || data.session_id;
    if (!sessionId) return;

    try {
      switch (payload.event) {
        case 'SessionStart': {
          upsertSession(db, {
            id: sessionId,
            cwd: data.cwd ?? process.cwd(),
            model: data.model ?? null,
            source: data.source ?? null,
            transcript_path: data.transcript_path ?? null,
          });
          break;
        }
        case 'UserPromptSubmit': {
          if (!data.prompt) break;
          upsertSession(db, {
            id: sessionId,
            cwd: data.cwd ?? process.cwd(),
            transcript_path: data.transcript_path ?? null,
          });
          const usage = insertPromptUsage(db, {
            session_id: sessionId,
            prompt_text: data.prompt,
          });
          let piiHits: Record<string, number> | undefined;
          if (usage.pii_hits) {
            try {
              const parsed = JSON.parse(usage.pii_hits);
              if (parsed && typeof parsed === 'object') piiHits = parsed;
            } catch {
              // ignore — rule just won't fire
            }
          }
          const hits = runRules({
            promptText: data.prompt,
            session: { cwd: data.cwd ?? '/' },
            meta: {
              charLen: usage.char_len,
              wordCount: usage.word_count,
              piiHits,
            },
          });
          for (const h of hits) {
            insertRuleHit(db, {
              usage_id: usage.id,
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
            usage_id: usage.id,
            rule_score: ruleScore,
            final_score,
            tier,
            rules_version: 1,
          });
          logger.info(
            {
              session_id: sessionId,
              usage_id: usage.id,
              score: final_score,
              tier,
              hits: hits.length,
            },
            'user-prompt-submit'
          );
          break;
        }
        case 'SubagentStart': {
          upsertSession(db, { id: sessionId, cwd: data.cwd ?? '/' });
          upsertSubagent(db, {
            session_id: sessionId,
            agent_type: data.agent_type ?? 'unknown',
            agent_id: data.agent_id ?? sessionId,
          });
          break;
        }
        case 'SubagentStop': {
          upsertSession(db, { id: sessionId, cwd: data.cwd ?? '/' });
          upsertSubagent(db, {
            session_id: sessionId,
            agent_type: data.agent_type ?? 'unknown',
            agent_id: data.agent_id ?? sessionId,
            transcript_path: data.agent_transcript_path ?? null,
          });
          if (data.agent_transcript_path) {
            enqueue(paths.queueFile, 'parse_subagent_transcript', {
              session_id: sessionId,
              agent_id: data.agent_id ?? sessionId,
              agent_transcript_path: data.agent_transcript_path,
            });
          } else {
            finishSubagent(db, sessionId, data.agent_id ?? sessionId, {});
          }
          break;
        }
        case 'PostToolUse': {
          upsertSession(db, { id: sessionId, cwd: data.cwd ?? '/' });
          const inputSize = JSON.stringify(data.tool_input ?? '').length;
          const outputSize = JSON.stringify(data.tool_response ?? '').length;
          bumpToolRollup(db, {
            session_id: sessionId,
            tool_name: data.tool_name ?? 'unknown',
            failed: false,
            ms: 0,
            in_bytes: inputSize,
            out_bytes: outputSize,
          });
          break;
        }
        case 'Stop': {
          endSession(db, sessionId);
          if (data.transcript_path) {
            enqueue(paths.queueFile, 'parse_transcript', {
              session_id: sessionId,
              transcript_path: data.transcript_path,
            });
          }
          enqueue(paths.queueFile, 'session_end', { session_id: sessionId });
          break;
        }
        default:
          // Other hook events (PreToolUse, Notification, etc.) are not
          // captured by the prompt subsystem — they go only to the UI.
          break;
      }
    } catch (err) {
      logger.error({ err, event: payload.event }, 'ingest failed');
      if (!config.agent.fail_open) throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Fastify instance — read-only JSON API + browser-extension ingest.
  // Mounted via fastify.routing() on the shared http.Server; never
  // calls .listen().
  // ---------------------------------------------------------------------
  const fastify = Fastify({
    logger: false,
    bodyLimit: config.agent.max_prompt_bytes + 16 * 1024,
  });

  // CORS for browser-extension endpoint (same as legacy buildAgentServer).
  fastify.addHook('onSend', async (req, reply, payload) => {
    if (!req.url.startsWith('/v1/ingest/web')) return payload;
    const origin = (req.headers.origin as string | undefined) ?? '*';
    reply.header('access-control-allow-origin', origin);
    reply.header('access-control-allow-methods', 'POST, OPTIONS');
    reply.header('access-control-allow-headers', 'content-type, x-think-prompt-ext');
    reply.header('access-control-allow-private-network', 'true');
    reply.header('vary', 'origin');
    return payload;
  });

  fastify.route({
    method: 'OPTIONS',
    url: '/v1/ingest/web',
    handler: async (_req, reply) => {
      reply.code(204).send();
    },
  });

  fastify.post('/v1/ingest/web', async (req, reply) => {
    const t0 = Date.now();
    const extHeader = req.headers['x-think-prompt-ext'];
    if (extHeader !== '1') {
      reply.code(403);
      return { ok: false, error: 'missing X-Think-Prompt-Ext header' };
    }
    try {
      const p = WebIngestPayload.parse(req.body);
      const sessionId = `${p.source}:${p.browser_session_id}`;
      upsertSession(db, {
        id: sessionId,
        cwd: `web:${p.source}`,
        source: p.source,
      });
      const usage = insertPromptUsage(db, {
        session_id: sessionId,
        prompt_text: p.prompt_text,
        browser_session_id: p.browser_session_id,
      });
      let piiHits: Record<string, number> | undefined;
      if (usage.pii_hits) {
        try {
          const parsed = JSON.parse(usage.pii_hits);
          if (parsed && typeof parsed === 'object') {
            piiHits = parsed as Record<string, number>;
          }
        } catch {
          // ignore
        }
      }
      if (p.pii_hits) {
        piiHits = { ...(piiHits ?? {}), ...p.pii_hits };
      }
      const hits = runRules({
        promptText: p.prompt_text,
        session: { cwd: `web:${p.source}` },
        meta: { charLen: usage.char_len, wordCount: usage.word_count, piiHits },
      });
      for (const h of hits) {
        insertRuleHit(db, {
          usage_id: usage.id,
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
        usage_id: usage.id,
        rule_score: ruleScore,
        final_score,
        tier,
        rules_version: 1,
      });
      logger.info(
        {
          source: p.source,
          usage_id: usage.id,
          score: final_score,
          tier,
          hits: hits.length,
          ms: Date.now() - t0,
        },
        'web-ingest'
      );
      return {
        ok: true,
        usage_id: usage.id,
        score: final_score,
        tier,
        hits: hits.map((h) => ({
          rule_id: h.ruleId,
          severity: h.severity,
          message: h.message,
        })),
      };
    } catch (err) {
      logger.error({ err }, 'web-ingest failed');
      if (config.agent.fail_open) return { ok: false };
      throw err;
    }
  });

  // ---------------------------------------------------------------------
  // Dashboard aggregates. Computing these on the client from /api/prompts
  // would cap at the fetch limit (100) and miss historical totals; doing
  // it in SQL stays cheap (indexed columns) and gives the dashboard a
  // single round-trip.
  // ---------------------------------------------------------------------
  fastify.get('/api/prompts/stats', async () => {
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS total,
                AVG(qs.final_score) AS avg_score
         FROM prompt_usages pu
         LEFT JOIN quality_scores qs ON qs.usage_id = pu.id`
      )
      .get() as { total: number; avg_score: number | null };

    const tierRows = db
      .prepare(
        `SELECT qs.tier AS tier, COUNT(*) AS count
         FROM quality_scores qs
         GROUP BY qs.tier`
      )
      .all() as Array<{ tier: string | null; count: number }>;
    const tierDistribution: Record<string, number> = {
      good: 0,
      ok: 0,
      weak: 0,
      bad: 0,
    };
    for (const r of tierRows) {
      if (r.tier && r.tier in tierDistribution) {
        tierDistribution[r.tier] = r.count;
      }
    }

    // Daily averages for the last 30 days. SQLite's date() truncates the
    // ISO timestamp at the day boundary; rows with no score yet are
    // excluded from the average via INNER JOIN.
    const daily = db
      .prepare(
        `SELECT date(pu.created_at) AS day,
                COUNT(*) AS count,
                AVG(qs.final_score) AS avg_score
         FROM prompt_usages pu
         INNER JOIN quality_scores qs ON qs.usage_id = pu.id
         WHERE pu.created_at >= datetime('now', '-30 days')
         GROUP BY day
         ORDER BY day ASC`
      )
      .all() as Array<{ day: string; count: number; avg_score: number | null }>;

    // Top improvement opportunities — rule_ids that fire most often,
    // weighted by severity so a single SEV5 hit outweighs many SEV1s.
    const topRules = db
      .prepare(
        `SELECT rh.rule_id AS rule_id,
                COUNT(*) AS hits,
                MAX(rh.severity) AS max_severity,
                AVG(rh.severity) AS avg_severity,
                (SELECT message FROM rule_hits WHERE rule_id = rh.rule_id ORDER BY severity DESC LIMIT 1) AS sample_message
         FROM rule_hits rh
         GROUP BY rh.rule_id
         ORDER BY hits * avg_severity DESC
         LIMIT 8`
      )
      .all() as Array<{
      rule_id: string;
      hits: number;
      max_severity: number;
      avg_severity: number;
      sample_message: string;
    }>;

    return {
      total: totals.total,
      avg_score: totals.avg_score,
      tier_distribution: tierDistribution,
      daily,
      top_rules: topRules,
    };
  });

  fastify.get('/api/prompts', async (req) => {
    const q = req.query as { limit?: string; tier?: string; session_id?: string };
    const limit = Math.min(Math.max(Number.parseInt(q.limit ?? '50', 10) || 50, 1), 500);
    const conds: string[] = [];
    const params: Record<string, string> = {};
    if (q.tier) {
      conds.push('qs.tier = @tier');
      params.tier = q.tier;
    }
    if (q.session_id) {
      conds.push('pu.session_id = @session_id');
      params.session_id = q.session_id;
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT pu.id, pu.session_id, pu.pii_masked AS prompt, pu.char_len, pu.word_count,
                pu.created_at, pu.turn_index,
                qs.final_score, qs.rule_score, qs.usage_score, qs.tier,
                qs.efficiency_score, qs.confidence, qs.baseline_delta
         FROM prompt_usages pu
         LEFT JOIN quality_scores qs ON qs.usage_id = pu.id
         ${where}
         ORDER BY pu.created_at DESC
         LIMIT ${limit}`
      )
      .all(params);
    return { prompts: rows };
  });

  fastify.get('/api/prompts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db
      .prepare(
        `SELECT pu.id, pu.session_id, pu.pii_masked AS prompt, pu.char_len, pu.word_count,
                pu.created_at, pu.turn_index, pu.coach_context,
                qs.final_score, qs.rule_score, qs.usage_score, qs.judge_score, qs.tier,
                qs.computed_at, qs.rules_version,
                qs.efficiency_score, qs.confidence, qs.baseline_delta
         FROM prompt_usages pu
         LEFT JOIN quality_scores qs ON qs.usage_id = pu.id
         WHERE pu.id = ? OR pu.id LIKE ? || '%'
         LIMIT 1`
      )
      .get(id, id) as { id: string } | undefined;
    if (!row) {
      reply.code(404);
      return { error: 'not found' };
    }
    const hits = db
      .prepare(
        `SELECT rule_id, severity, message, evidence
         FROM rule_hits WHERE usage_id = ? ORDER BY severity DESC, rule_id`
      )
      .all(row.id);
    return { prompt: row, hits };
  });

  fastify.get('/api/sessions', async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number.parseInt(q.limit ?? '50', 10) || 50, 1), 500);
    const rows = db
      .prepare(
        `SELECT s.id, s.cwd, s.model, s.source, s.started_at, s.ended_at, s.stop_count,
                COUNT(pu.id) AS prompt_count,
                AVG(qs.final_score) AS avg_score
         FROM sessions s
         LEFT JOIN prompt_usages pu ON pu.session_id = s.id
         LEFT JOIN quality_scores qs ON qs.usage_id = pu.id
         GROUP BY s.id
         ORDER BY s.started_at DESC
         LIMIT ${limit}`
      )
      .all();
    return { sessions: rows };
  });

  fastify.get('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = db
      .prepare(
        `SELECT id, cwd, model, source, started_at, ended_at, transcript_path, stop_count
         FROM sessions WHERE id = ?`
      )
      .get(id) as { id: string } | undefined;
    if (!session) {
      reply.code(404);
      return { error: 'not found' };
    }
    const prompts = db
      .prepare(
        `SELECT pu.id, pu.pii_masked AS prompt, pu.created_at, pu.turn_index,
                qs.final_score, qs.tier, qs.confidence, qs.baseline_delta
         FROM prompt_usages pu
         LEFT JOIN quality_scores qs ON qs.usage_id = pu.id
         WHERE pu.session_id = ?
         ORDER BY pu.turn_index ASC`
      )
      .all(id);
    return { session, prompts };
  });

  function close(): void {
    try {
      db.close();
    } catch {
      // ignore
    }
  }

  return { ingest, fastify, close };
}

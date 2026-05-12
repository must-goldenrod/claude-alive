/**
 * Hook payload schemas (zod) — based on docs/01-hook-design.md.
 * All payloads share a base set of fields.
 */
import { z } from 'zod';

export const BaseHookPayload = z.object({
  session_id: z.string(),
  cwd: z.string().optional().default(''),
  hook_event_name: z.string().optional(),
  transcript_path: z.string().optional(),
});

export const UserPromptSubmitPayload = BaseHookPayload.extend({
  prompt: z.string(),
});

export const SessionStartPayload = BaseHookPayload.extend({
  source: z.string().optional(),
  model: z.string().optional(),
});

export const SubagentStartPayload = BaseHookPayload.extend({
  agent_id: z.string(),
  agent_type: z.string(),
});

export const SubagentStopPayload = BaseHookPayload.extend({
  agent_id: z.string(),
  agent_type: z.string(),
  agent_transcript_path: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
});

export const PostToolUsePayload = BaseHookPayload.extend({
  tool_name: z.string(),
  tool_input: z.unknown().optional(),
  tool_response: z.unknown().optional(),
  tool_use_id: z.string().optional(),
});

export const StopPayload = BaseHookPayload.extend({
  stop_hook_active: z.boolean().optional(),
});

/**
 * /v1/ingest/web — posted by the browser extension when the user submits a
 * prompt on a supported LLM web UI. See docs/09-browser-extension-design.md.
 */
export const WebIngestPayload = z.object({
  source: z.enum(['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'genspark', 'mistral', 'other']),
  browser_session_id: z.string().min(1),
  prompt_text: z.string().min(1),
  pii_masked: z.string().optional(),
  pii_hits: z.record(z.string(), z.number()).optional(),
  created_at: z.string().optional(),
});

export type WebIngest = z.infer<typeof WebIngestPayload>;

export type UserPromptSubmit = z.infer<typeof UserPromptSubmitPayload>;
export type SessionStart = z.infer<typeof SessionStartPayload>;
export type SubagentStart = z.infer<typeof SubagentStartPayload>;
export type SubagentStop = z.infer<typeof SubagentStopPayload>;
export type PostToolUse = z.infer<typeof PostToolUsePayload>;
export type StopEvt = z.infer<typeof StopPayload>;

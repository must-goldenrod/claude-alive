import { z } from 'zod';
import type { WSClientMessage } from '@claude-alive/core';

/**
 * Runtime validation for inbound WebSocket client messages.
 *
 * The WS boundary is untrusted just like the HTTP boundary (which validates
 * every body via Zod in httpRouter). Without this, `JSON.parse(...) as
 * WSClientMessage` trusts arbitrary input: a non-string `tabId` would be used
 * directly as a Map key and persistence key, and a non-string `cwd` reaching
 * `pty.spawn` can throw. Validating here keeps those malformed payloads out.
 */
const terminalMode = z.enum(['claude', 'shell']);
const terminalSource = z.enum(['local', 'ssh']);
const claudeVariant = z.enum(['claude', 'agents']);

const schema: z.ZodType<WSClientMessage> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('request:snapshot') }),
  z.object({
    type: z.literal('terminal:spawn'),
    tabId: z.string().min(1),
    cwd: z.string().optional(),
    skipPermissions: z.boolean().optional(),
    mode: terminalMode.optional(),
    source: terminalSource.optional(),
    initialCommand: z.string().optional(),
    claudeVariant: claudeVariant.optional(),
    claudeSessionId: z.string().optional(),
    resumeSessionId: z.string().optional(),
    displayName: z.string().optional(),
  }),
  z.object({ type: z.literal('terminal:input'), tabId: z.string().min(1), data: z.string() }),
  z.object({
    type: z.literal('terminal:resize'),
    tabId: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  z.object({ type: z.literal('terminal:close'), tabId: z.string().min(1) }),
  z.object({ type: z.literal('terminal:attach'), tabId: z.string().min(1) }),
]) as z.ZodType<WSClientMessage>;

/** Parse and validate a raw WS payload. Returns the message or null if invalid. */
export function parseClientMessage(raw: string): WSClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}

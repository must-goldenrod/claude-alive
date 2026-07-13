/**
 * Terminal tab id generation.
 *
 * A tabId MUST be globally unique across page reloads and browser sessions. The
 * server owns terminals in a single global map keyed by tabId, so if two loads
 * produce the same id, `terminal:spawn` for a "new" tab collides with a live
 * terminal and the server *attaches* to it instead of spawning a fresh Claude
 * session — the New Chat looks like it opened an old, unrelated conversation.
 *
 * The previous implementation used a per-load counter (`tab-1`, `tab-2`, …) which
 * reset to 1 on every reload and collided with the server's persisted/live
 * terminals. We now embed a UUID so ids never repeat.
 */

/**
 * Fallback v4-ish UUID for environments without `crypto.randomUUID`.
 * Claude CLI validates UUID format, so we keep the canonical 8-4-4-4-12 hex layout.
 */
export function generateFallbackUuid(): string {
  const rnd = () => Math.random().toString(16).slice(2, 10);
  const a = rnd();
  const b = rnd().slice(0, 4);
  const c = '4' + rnd().slice(0, 3);
  const d = ((parseInt(rnd().slice(0, 1), 16) & 0x3) | 0x8).toString(16) + rnd().slice(0, 3);
  const e = rnd() + rnd().slice(0, 4);
  return `${a}-${b}-${c}-${d}-${e}`;
}

/** Globally-unique terminal tab id. */
export function makeTabId(): string {
  const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID?.()) || generateFallbackUuid();
  return `tab-${uuid}`;
}

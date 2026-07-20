/**
 * Codex runtime adapter (spec §H.2, §H.3; ADR-0004).
 *
 * Transport-agnostic on purpose: the adapter consumes an async source of
 * app-server JSON-RPC messages, so the same code runs against a recorded fixture
 * (deterministic tests, no install needed — §R.1) and against a real
 * `codex app-server` stdio child process. Wiring the child process is the
 * remaining piece; the mapping and the contract are exercised here.
 *
 * **Verification status:** fixture-verified only. No smoke test against an
 * installed Codex has run on this machine, so ADR-0004 stays Conditionally
 * Accepted until `initialize`/`thread/start` are confirmed live.
 */

import type { AgentRuntimeAdapter, AdapterHealth, RuntimeInstallation, StartSessionInput } from './adapter.js';
import type { ProviderCapabilities } from './capabilities.js';
import type { CanonicalEvent } from './events.js';
import { codexEventToCanonical, type CodexServerMessage } from './codexToCanonical.js';
import { ulid } from './ids.js';

/**
 * What the app-server protocol supports. `subagents: 'none'` because Codex
 * reports items, not nested agents; `artifacts: false` because file changes
 * arrive as tool items rather than as a distinct artifact channel.
 */
export const CODEX_CAPABILITIES: ProviderCapabilities = {
  structuredEvents: true,
  streamingMessages: true,
  toolLifecycle: true,
  approvals: 'native',
  tokenUsage: 'live',
  subagents: 'none',
  resume: 'stable-id',
  interrupt: true,
  steer: true,
  mcpInventory: true,
  artifacts: false,
};

export interface CodexAdapterOptions {
  /** Message source: a recorded fixture, or a live app-server stream. */
  messages: Iterable<CodexServerMessage> | AsyncIterable<CodexServerMessage>;
  installation?: RuntimeInstallation;
  /** Called when the caller sends input; the transport layer supplies this. */
  onSend?: (sessionId: string, text: string) => Promise<void>;
  onInterrupt?: (sessionId: string) => Promise<void>;
  onApprove?: (approvalId: string, decision: 'allow' | 'deny') => Promise<void>;
}

export function createCodexAdapter(options: CodexAdapterOptions): AgentRuntimeAdapter {
  const installation = options.installation ?? { installed: false, detail: 'not detected' };
  let workspaceId = 'unknown';

  return {
    provider: 'codex',

    async detect() {
      return installation;
    },

    async capabilities() {
      return CODEX_CAPABILITIES;
    },

    async health(): Promise<AdapterHealth> {
      return installation.installed
        ? { status: 'ok' }
        : { status: 'down', detail: installation.detail ?? 'codex not installed' };
    },

    async start(input: StartSessionInput) {
      workspaceId = input.workspaceId;
      return { sessionId: input.sessionId };
    },

    async *attach(ref): AsyncIterable<CanonicalEvent> {
      const ctx = {
        sessionId: ref.sessionId,
        workspaceId,
        receivedAt: Date.now(),
        newEventId: ulid,
      };
      for await (const message of options.messages as AsyncIterable<CodexServerMessage>) {
        // One protocol message can map to zero or more canonical events.
        for (const event of codexEventToCanonical(message, ctx)) yield event;
      }
    },

    async send(sessionId, input) {
      await options.onSend?.(sessionId, input.text);
    },

    async interrupt(sessionId) {
      await options.onInterrupt?.(sessionId);
    },

    async approve(request) {
      await options.onApprove?.(request.approvalId, request.decision);
    },

    async resume(ref) {
      return { sessionId: ref.sessionId, providerSessionId: ref.providerSessionId };
    },

    async close() {
      // The transport owns the child process; nothing to release in the mapper.
    },
  };
}

/**
 * Provider runtime adapter contract (spec §H.2).
 *
 * Every provider (Claude, Codex, Hermes, generic terminal) implements this same
 * interface. Optional methods (`approve`, `interrupt`, `resume`, `steer`) are
 * present only when the adapter's `capabilities()` declares support — the UI
 * gates affordances on capabilities, never on provider identity (§H.1).
 */

import type { CanonicalEvent } from './events.js';
import type { ProviderCapabilities, ProviderId } from './capabilities.js';

export type SessionId = string;

export interface RuntimeInstallation {
  installed: boolean;
  version?: string;
  /** Resolved executable path, when known. */
  path?: string;
  /** Human-readable note (e.g. why detection failed). */
  detail?: string;
}

export interface StartSessionInput {
  /** Alive stable session id assigned by the caller. */
  sessionId: SessionId;
  workspaceId: string;
  cwd: string;
  /** First user prompt, if the session starts with one. */
  prompt?: string;
  /** Provider-specific options (model, variant, flags). */
  options?: Record<string, unknown>;
}

export interface ProviderSessionRef {
  sessionId: SessionId;
  /** Provider-native session id, when resuming an existing session. */
  providerSessionId?: string;
}

export interface RuntimeSessionHandle {
  sessionId: SessionId;
  providerSessionId?: string;
}

export interface UserInput {
  text: string;
}

export interface ApprovalDecision {
  sessionId: SessionId;
  approvalId: string;
  decision: 'allow' | 'deny';
}

export interface AdapterHealth {
  status: 'ok' | 'degraded' | 'down';
  detail?: string;
}

export interface AgentRuntimeAdapter {
  readonly provider: ProviderId;
  detect(): Promise<RuntimeInstallation>;
  capabilities(): Promise<ProviderCapabilities>;
  start(input: StartSessionInput): Promise<RuntimeSessionHandle>;
  /** Stream of canonical events for a session; ends when the session closes. */
  attach(ref: ProviderSessionRef): AsyncIterable<CanonicalEvent>;
  send(sessionId: SessionId, input: UserInput): Promise<void>;
  approve?(request: ApprovalDecision): Promise<void>;
  interrupt?(sessionId: SessionId): Promise<void>;
  resume?(ref: ProviderSessionRef): Promise<RuntimeSessionHandle>;
  close(sessionId: SessionId): Promise<void>;
  health(): Promise<AdapterHealth>;
}

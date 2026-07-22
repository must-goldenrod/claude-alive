/**
 * Provider identity and capability matrix (spec §H.1).
 *
 * The UI must branch on capabilities, never on provider name — a new provider
 * that declares the same capabilities gets the same affordances for free.
 */

export const PROVIDER_IDS = ['claude', 'codex', 'hermes', 'terminal'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderCapabilities {
  structuredEvents: boolean;
  streamingMessages: boolean;
  toolLifecycle: boolean;
  approvals: 'native' | 'terminal' | 'none';
  tokenUsage: 'live' | 'final' | 'estimated' | 'none';
  subagents: 'full' | 'partial' | 'none';
  resume: 'stable-id' | 'best-effort' | 'none';
  interrupt: boolean;
  steer: boolean;
  mcpInventory: boolean;
  artifacts: boolean;
}

/**
 * Conservative capability floor for a provider we can only observe through a raw
 * PTY. Adapters override the fields they can actually guarantee.
 */
export const TERMINAL_CAPABILITIES: ProviderCapabilities = {
  structuredEvents: false,
  streamingMessages: false,
  toolLifecycle: false,
  approvals: 'terminal',
  tokenUsage: 'none',
  subagents: 'none',
  resume: 'none',
  interrupt: true,
  steer: false,
  mcpInventory: false,
  artifacts: false,
};

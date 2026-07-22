/**
 * Provider-neutral agent state (spec §I.2).
 *
 * The existing Claude FSM is not replaced wholesale; a mapping layer projects
 * provider-native states onto this common vocabulary, preserving the raw state
 * and a confidence marker so the UI never presents a heuristic guess as fact.
 */

export const COMMON_AGENT_STATES = [
  'starting',
  'ready',
  'thinking',
  'using-tool',
  'waiting-user',
  'paused',
  'completed',
  'failed',
  'stopped',
  'disconnected',
  'unknown',
] as const;

export type CommonAgentState = (typeof COMMON_AGENT_STATES)[number];

export type StateConfidence = 'exact' | 'derived' | 'heuristic';

export interface NormalizedState {
  common: CommonAgentState;
  /** The provider's own state string, preserved verbatim. */
  providerState: string;
  confidence: StateConfidence;
  reason?: string;
}

/**
 * Legacy AgentState → CommonAgentState mapping layer (spec §I.2).
 *
 * The existing Claude FSM is not replaced; this layer projects its vocabulary
 * onto the provider-neutral one while preserving the raw state and recording how
 * the mapping was reached, so the UI never shows a guess as fact.
 */

import type { CommonAgentState, NormalizedState } from './state.js';

const DIRECT: Record<string, CommonAgentState> = {
  spawning: 'starting',
  idle: 'ready',
  listening: 'ready',
  waiting: 'waiting-user',
  error: 'failed',
  done: 'completed',
  despawning: 'stopped',
  removed: 'stopped',
};

/**
 * `active` is the one legacy state that is genuinely two canonical states: the
 * agent is either running a tool or reasoning between tools. The FSM records the
 * current tool, so the distinction is recoverable rather than guessed.
 */
export function normalizeLegacyState(
  legacyState: string,
  currentTool: string | null | undefined,
): NormalizedState {
  if (legacyState === 'active') {
    return {
      common: currentTool ? 'using-tool' : 'thinking',
      providerState: legacyState,
      confidence: 'derived',
      reason: currentTool ? `running ${currentTool}` : 'active with no tool in flight',
    };
  }

  const mapped = DIRECT[legacyState];
  if (mapped) {
    return { common: mapped, providerState: legacyState, confidence: 'derived' };
  }

  return {
    common: 'unknown',
    providerState: legacyState,
    confidence: 'heuristic',
    reason: 'unrecognised legacy state',
  };
}

import type { AgentInfo } from '@claude-alive/core';
import type { ResolvedLocation } from '../gitResolver.js';
import type { RunUpsert } from '../runStore.js';

/** States where the agent is actively doing something. */
const BUSY = new Set(['spawning', 'active', 'listening']);

/**
 * Agent session → Run. Terminal states (`done`, `error`, `removed`) report
 * `waiting`, not `closed`: the session ended, the work has not been filed.
 */
export function agentToUpsert(agent: AgentInfo, location: ResolvedLocation): RunUpsert {
  return {
    runId: `agent:${agent.sessionId}`,
    location,
    kind: 'agent',
    sourceId: agent.sessionId,
    title: agent.displayName || agent.projectName || agent.sessionId,
    state: BUSY.has(agent.state) ? 'running' : 'waiting',
    startedAt: agent.createdAt,
  };
}

import { useTranslation } from 'react-i18next';
import type { AgentState, CompletedSession, TokenUsage } from '@claude-alive/core';
import { ArchiveSessionDetail } from '../../archive/ArchiveSessionDetail.tsx';
import { EmptyState } from './EmptyState.tsx';
import { useSessionResource } from './useSessionResource.ts';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;
const AGENT_STATES = new Set<AgentState>([
  'spawning',
  'idle',
  'listening',
  'active',
  'waiting',
  'error',
  'done',
  'despawning',
  'removed',
]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === 'number';
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value);
}

function isTokenUsage(value: unknown): value is TokenUsage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const usage = value as Record<string, unknown>;
  return (
    typeof usage.inputTokens === 'number' &&
    typeof usage.outputTokens === 'number' &&
    typeof usage.cacheCreationTokens === 'number' &&
    typeof usage.cacheReadTokens === 'number' &&
    typeof usage.totalTokens === 'number' &&
    typeof usage.apiCalls === 'number' &&
    typeof usage.model === 'string'
  );
}

function isOptionalTokenUsage(value: unknown): value is TokenUsage | null | undefined {
  return value === undefined || value === null || isTokenUsage(value);
}

function isCompletedSession(value: unknown): value is CompletedSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const session = value as Record<string, unknown>;
  return (
    typeof session.sessionId === 'string' &&
    typeof session.cwd === 'string' &&
    typeof session.projectName === 'string' &&
    typeof session.completedAt === 'number' &&
    isNullableString(session.lastPrompt) &&
    isNullableString(session.displayName) &&
    isOptionalTokenUsage(session.tokenUsage) &&
    isOptionalNumber(session.createdAt) &&
    isOptionalNumber(session.durationMs) &&
    (session.finalState === undefined ||
      (typeof session.finalState === 'string' &&
        AGENT_STATES.has(session.finalState as AgentState))) &&
    isOptionalNumber(session.totalEvents) &&
    (session.toolsUsed === undefined ||
      (Array.isArray(session.toolsUsed) &&
        session.toolsUsed.every((tool) => typeof tool === 'string'))) &&
    isOptionalNumber(session.toolCallCount) &&
    isOptionalNullableString(session.parentId)
  );
}

async function loadCompletedSession(
  sessionId: string,
  signal: AbortSignal,
): Promise<CompletedSession | null> {
  const response = await fetch(`${API_BASE}/api/completed?limit=1000`, { signal });
  if (!response.ok) {
    return null;
  }

  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const sessions = (data as Record<string, unknown>).sessions;
  if (!Array.isArray(sessions) || !sessions.every(isCompletedSession)) {
    return null;
  }
  return sessions.find((session) => session.sessionId === sessionId) ?? null;
}

interface ProcessPanelProps {
  sessionId: string | null;
}

export function ProcessPanel({ sessionId }: ProcessPanelProps) {
  const { t } = useTranslation();
  const resource = useSessionResource(sessionId, loadCompletedSession);

  if (!sessionId) {
    return <EmptyState message={t('board.empty.noSession')} />;
  }
  if (resource.status !== 'ready' || !resource.value) {
    return <EmptyState message={t('board.empty.noData')} />;
  }

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <ArchiveSessionDetail session={resource.value} />
    </div>
  );
}

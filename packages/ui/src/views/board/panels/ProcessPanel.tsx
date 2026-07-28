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

function normalizeCompletedSession(value: unknown): CompletedSession | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const session = value as Record<string, unknown>;
  if (typeof session.sessionId !== 'string') {
    return null;
  }

  const finalState =
    typeof session.finalState === 'string' &&
    AGENT_STATES.has(session.finalState as AgentState)
      ? (session.finalState as AgentState)
      : undefined;
  const toolsUsed =
    Array.isArray(session.toolsUsed) &&
    session.toolsUsed.every((tool) => typeof tool === 'string')
      ? session.toolsUsed
      : undefined;

  return {
    sessionId: session.sessionId,
    cwd: typeof session.cwd === 'string' ? session.cwd : '',
    projectName:
      typeof session.projectName === 'string' ? session.projectName : '',
    completedAt:
      typeof session.completedAt === 'number' ? session.completedAt : 0,
    lastPrompt: isNullableString(session.lastPrompt)
      ? session.lastPrompt
      : null,
    displayName: isNullableString(session.displayName)
      ? session.displayName
      : null,
    tokenUsage: isOptionalTokenUsage(session.tokenUsage)
      ? session.tokenUsage
      : null,
    createdAt: isOptionalNumber(session.createdAt)
      ? session.createdAt
      : undefined,
    durationMs: isOptionalNumber(session.durationMs)
      ? session.durationMs
      : undefined,
    finalState,
    totalEvents: isOptionalNumber(session.totalEvents)
      ? session.totalEvents
      : undefined,
    toolsUsed,
    toolCallCount: isOptionalNumber(session.toolCallCount)
      ? session.toolCallCount
      : undefined,
    parentId: isOptionalNullableString(session.parentId)
      ? session.parentId
      : undefined,
  };
}

async function loadCompletedSession(
  sessionId: string,
  signal: AbortSignal,
): Promise<CompletedSession | null> {
  const response = await fetch(`${API_BASE}/api/completed?limit=2000`, { signal });
  if (!response.ok) {
    return null;
  }

  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const sessions = (data as Record<string, unknown>).sessions;
  if (!Array.isArray(sessions)) {
    return null;
  }
  const rawMatch = sessions.find(
    (session) =>
      typeof session === 'object' &&
      session !== null &&
      (session as Record<string, unknown>).sessionId === sessionId,
  );
  return normalizeCompletedSession(rawMatch);
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
  if (resource.status === 'loading') {
    return <EmptyState message={t('archive.loading')} />;
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

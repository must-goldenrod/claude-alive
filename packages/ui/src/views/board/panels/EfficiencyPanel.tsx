import { useTranslation } from 'react-i18next';
import type {
  EfficioAxisKey,
  EfficioAxisScore,
  EfficioProfiles,
  EfficioRepeat,
  EfficioSessionProfile,
} from '@claude-alive/core';
import { SessionDetailCard } from '../../efficio/SessionDetailCard.tsx';
import { EmptyState } from './EmptyState.tsx';
import { useSessionResource } from './useSessionResource.ts';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;
const AXIS_KEYS = ['w2', 'wc', 'bash', 'w3'] as const satisfies readonly EfficioAxisKey[];

function isAxisScore(value: unknown): value is EfficioAxisScore {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const score = value as Record<string, unknown>;
  return (
    typeof score.actual === 'number' &&
    typeof score.baseline === 'number' &&
    typeof score.residual === 'number' &&
    typeof score.wastePercentile === 'number' &&
    typeof score.isZero === 'boolean'
  );
}

function isRepeat(value: unknown): value is EfficioRepeat {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const repeat = value as Record<string, unknown>;
  return typeof repeat.item === 'string' && typeof repeat.count === 'number';
}

function isSessionProfile(value: unknown): value is EfficioSessionProfile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const profile = value as Record<string, unknown>;
  const axes = profile.axes;
  return (
    typeof profile.sessionId === 'string' &&
    typeof profile.title === 'string' &&
    (profile.project === null || typeof profile.project === 'string') &&
    typeof profile.tsFirst === 'number' &&
    typeof profile.turns === 'number' &&
    typeof profile.totalTokens === 'number' &&
    typeof profile.cacheCreation === 'number' &&
    typeof profile.cacheRead === 'number' &&
    typeof axes === 'object' &&
    axes !== null &&
    AXIS_KEYS.every((key) => isAxisScore((axes as Record<string, unknown>)[key])) &&
    Array.isArray(profile.topBash) &&
    profile.topBash.every(isRepeat) &&
    Array.isArray(profile.topEdits) &&
    profile.topEdits.every(isRepeat)
  );
}

function isProfiles(value: unknown): value is EfficioProfiles {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const profiles = value as Record<string, unknown>;
  return (
    (profiles.modelVersion === null || typeof profiles.modelVersion === 'number') &&
    Array.isArray(profiles.sessions) &&
    profiles.sessions.every(isSessionProfile)
  );
}

async function loadProfile(
  sessionId: string,
  signal: AbortSignal,
): Promise<EfficioSessionProfile | null> {
  const response = await fetch(`${API_BASE}/api/efficio/profiles?last=1000`, { signal });
  if (!response.ok) {
    return null;
  }

  const data: unknown = await response.json();
  if (!isProfiles(data)) {
    return null;
  }
  return data.sessions.find((profile) => profile.sessionId === sessionId) ?? null;
}

interface EfficiencyPanelProps {
  sessionId: string | null;
}

export function EfficiencyPanel({ sessionId }: EfficiencyPanelProps) {
  const { t } = useTranslation();
  const resource = useSessionResource(sessionId, loadProfile);

  if (!sessionId) {
    return <EmptyState message={t('board.empty.noSession')} />;
  }
  if (resource.status !== 'ready' || !resource.value) {
    return <EmptyState message={t('board.empty.noData')} />;
  }

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <SessionDetailCard session={resource.value} />
    </div>
  );
}

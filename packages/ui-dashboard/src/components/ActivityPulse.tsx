import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EventLogEntry } from '@claude-alive/core';
import { useNow } from '../hooks/useNow';

const WINDOW_SECONDS = 60;
const MAX_HEIGHT = 48;

type EventCategory = 'tool' | 'prompt' | 'permission' | 'system';

const EVENT_CATEGORY: Record<string, EventCategory> = {
  PreToolUse: 'tool',
  PostToolUse: 'tool',
  PostToolUseFailure: 'tool',
  UserPromptSubmit: 'prompt',
  PermissionRequest: 'permission',
  SessionStart: 'system',
  SessionEnd: 'system',
  Stop: 'system',
  Notification: 'system',
  SubagentStart: 'system',
  SubagentStop: 'system',
  ConfigChange: 'system',
};

const CATEGORY_COLORS: Record<EventCategory, string> = {
  tool: 'var(--accent-green)',
  prompt: 'var(--accent-blue)',
  permission: 'var(--accent-amber)',
  system: 'var(--text-secondary)',
};

interface ActivityPulseProps {
  events: EventLogEntry[];
}

export function ActivityPulse({ events }: ActivityPulseProps) {
  const { t } = useTranslation();
  const now = useNow();

  const bars = useMemo(() => {
    const windowStart = now - WINDOW_SECONDS * 1000;
    const recentEvents = events.filter((e) => e.timestamp >= windowStart);

    // Bucket events by second
    const buckets: { tool: number; prompt: number; permission: number; system: number }[] =
      Array.from({ length: WINDOW_SECONDS }, () => ({
        tool: 0,
        prompt: 0,
        permission: 0,
        system: 0,
      }));

    for (const event of recentEvents) {
      const secondIdx = Math.floor((event.timestamp - windowStart) / 1000);
      if (secondIdx < 0 || secondIdx >= WINDOW_SECONDS) continue;
      const category = EVENT_CATEGORY[event.event];
      if (!category) continue; // skip unknown events
      buckets[secondIdx]![category]++;
    }

    // Find max for normalization
    const bucketTotal = (b: (typeof buckets)[0]) =>
      b.tool + b.prompt + b.permission + b.system;
    const maxTotal = Math.max(1, ...buckets.map(bucketTotal));

    return buckets.map((bucket) => {
      const total = bucketTotal(bucket);
      const height = Math.max(total > 0 ? 3 : 0, (total / maxTotal) * MAX_HEIGHT);
      // Dominant category determines color
      let color = CATEGORY_COLORS.tool;
      if (bucket.system >= bucket.tool && bucket.system >= bucket.prompt && bucket.system >= bucket.permission) {
        color = CATEGORY_COLORS.system;
      } else if (bucket.permission >= bucket.tool && bucket.permission >= bucket.prompt) {
        color = CATEGORY_COLORS.permission;
      } else if (bucket.prompt >= bucket.tool) {
        color = CATEGORY_COLORS.prompt;
      }
      return { height, color, total };
    });
  }, [events, now]);

  return (
    <div
      className="border rounded-lg overflow-hidden"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <div
        className="px-5 py-3 text-sm font-medium border-b flex items-center justify-between"
        style={{
          color: 'var(--text-secondary)',
          borderColor: 'var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        <span>{t('activity.title')}</span>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CATEGORY_COLORS.tool }} />
            {t('activity.tools')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CATEGORY_COLORS.prompt }} />
            {t('activity.prompts')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CATEGORY_COLORS.permission }} />
            {t('activity.permissions')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CATEGORY_COLORS.system }} />
            {t('activity.system')}
          </span>
        </div>
      </div>
      <div className="px-4 py-4 flex items-end gap-px" style={{ height: MAX_HEIGHT + 32 }}>
        {bars.map((bar, i) => (
          <div
            key={i}
            className="rounded-sm transition-all duration-300"
            style={{
              height: bar.height,
              background: bar.color,
              opacity: bar.total > 0 ? 0.8 : 0.15,
              flex: '1 1 0',
            }}
          />
        ))}
      </div>
    </div>
  );
}

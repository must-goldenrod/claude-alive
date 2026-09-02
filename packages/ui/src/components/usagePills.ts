/**
 * Turns a {@link UsageLimitsSnapshot} into the header pills shown next to
 * CPU/RAM. Kept apart from HeaderBar so the ordering, omission and overage
 * rules are unit-testable without rendering.
 */
import type { UsageLimitsSnapshot, UsageWindow } from '@claude-alive/core';

export interface UsagePill {
  /** Short uppercase label: `5H`, `7D`, or the model name (e.g. `FABLE`). */
  label: string;
  /** Bar fill, clamped to 0..1 — an overage would otherwise overflow the track. */
  ratio: number;
  /** Displayed percentage, NOT clamped, so an overage still reads as >100%. */
  percent: number;
  /** Unix ms of the window reset, or null when the API reports none. */
  resetsAt: number | null;
  /** True when the poll behind these numbers failed and they are last-known. */
  stale: boolean;
}

function pill(label: string, window: UsageWindow, stale: boolean): UsagePill {
  return {
    label,
    ratio: Math.max(0, Math.min(1, window.utilization)),
    percent: Math.round(window.utilization * 100),
    resetsAt: window.resetsAt,
    stale,
  };
}

/** Build the pill list, skipping windows the API did not report. */
export function toUsagePills(snapshot: UsageLimitsSnapshot | null): UsagePill[] {
  if (!snapshot) return [];
  const pills: UsagePill[] = [];
  if (snapshot.fiveHour) pills.push(pill('5H', snapshot.fiveHour, snapshot.stale));
  if (snapshot.sevenDay) pills.push(pill('7D', snapshot.sevenDay, snapshot.stale));
  for (const scoped of snapshot.scopedWeekly) {
    pills.push(pill(scoped.modelName.toUpperCase(), scoped, snapshot.stale));
  }
  return pills;
}

/**
 * Compact "time until reset" for the pill tooltip: `3d 4h`, `2h 30m`, `45m`.
 * Null when there is no reset time, or the window has already rolled over
 * (the next poll will bring the new one).
 */
export function formatResetsIn(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null;
  const ms = resetsAt - now;
  if (ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

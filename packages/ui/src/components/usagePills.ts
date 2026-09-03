/**
 * Turns a {@link UsageLimitsSnapshot} into the header pills shown next to
 * CPU/RAM. Kept apart from HeaderBar so the ordering, omission, colour and
 * countdown rules are unit-testable without rendering.
 */
import type { UsageLimitsSnapshot, UsageWindow } from '@claude-alive/core';

/** How a window's countdown reads: `2h 30m` for the session, `3d 04h` weekly. */
export type RemainingUnit = 'hm' | 'dh';

/**
 * Per-window base colours. Deliberately outside the CPU/RAM ramp
 * (green → blue → amber → red) so a usage pill is never mistaken for a host
 * metric, and distinct from each other so the three windows read apart at a
 * glance even before their labels are read.
 */
const SESSION_COLOR = 'var(--accent-teal)';
const WEEKLY_COLOR = 'var(--accent-purple)';
const SCOPED_COLOR = 'var(--accent-pink)';

/** Usage fractions at which the base colour gives way to a warning colour. */
const WARN_AT = 0.65;
const CRITICAL_AT = 0.85;

export interface UsagePill {
  /** Short uppercase label: `5H`, `7D`, or the model name (e.g. `FABLE`). */
  label: string;
  /** Bar fill, clamped to 0..1 — an overage would otherwise overflow the track. */
  ratio: number;
  /** Displayed percentage, NOT clamped, so an overage still reads as >100%. */
  percent: number;
  /** Unix ms of the window reset, or null when the API reports none. */
  resetsAt: number | null;
  /** Countdown granularity for this window. */
  remainingUnit: RemainingUnit;
  /** This window's own colour, before any warning escalation. */
  baseColor: string;
  /** True when the poll behind these numbers failed and they are last-known. */
  stale: boolean;
}

function pill(
  label: string,
  window: UsageWindow,
  remainingUnit: RemainingUnit,
  baseColor: string,
  stale: boolean,
): UsagePill {
  return {
    label,
    ratio: Math.max(0, Math.min(1, window.utilization)),
    percent: Math.round(window.utilization * 100),
    resetsAt: window.resetsAt,
    remainingUnit,
    baseColor,
    stale,
  };
}

/** Build the pill list, skipping windows the API did not report. */
export function toUsagePills(snapshot: UsageLimitsSnapshot | null): UsagePill[] {
  if (!snapshot) return [];
  const pills: UsagePill[] = [];
  if (snapshot.fiveHour) {
    pills.push(pill('5H', snapshot.fiveHour, 'hm', SESSION_COLOR, snapshot.stale));
  }
  if (snapshot.sevenDay) {
    pills.push(pill('7D', snapshot.sevenDay, 'dh', WEEKLY_COLOR, snapshot.stale));
  }
  for (const scoped of snapshot.scopedWeekly) {
    pills.push(pill(scoped.modelName.toUpperCase(), scoped, 'dh', SCOPED_COLOR, snapshot.stale));
  }
  return pills;
}

/**
 * The colour a pill actually paints: its own hue while usage is unremarkable,
 * escalating to the shared amber/red once the limit is in sight. Warnings win
 * over identity — a window about to run out must look alarming, not decorative.
 */
export function usagePillColor(baseColor: string, ratio: number): string {
  if (ratio >= CRITICAL_AT) return 'var(--accent-red)';
  if (ratio >= WARN_AT) return 'var(--accent-amber)';
  return baseColor;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Time until the window resets, at the granularity that window deserves:
 * `hm` → `2h 30m` (the 5-hour session), `dh` → `3d 04h` (the weekly windows).
 * Null when there is no reset time, or the window has already rolled over —
 * the next poll brings the new one.
 */
export function formatRemaining(
  resetsAt: number | null,
  now: number,
  unit: RemainingUnit,
): string | null {
  if (resetsAt === null) return null;
  const ms = resetsAt - now;
  if (ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (unit === 'hm') {
    return `${Math.floor(minutes / 60)}h ${pad2(minutes % 60)}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${Math.floor(hours / 24)}d ${pad2(hours % 24)}h`;
}

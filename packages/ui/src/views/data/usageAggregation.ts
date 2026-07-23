/**
 * Pure aggregation of LLM usage across tickets + completed sessions, for the
 * "Tools > Data" dashboard. No React, no I/O — it takes the two raw arrays the
 * server already serves (`/api/tickets`, `/api/completed`) and folds them into
 * per-model and per-period totals.
 *
 * Kept in the UI package (not core) on purpose: importing a runtime value from
 * `@claude-alive/core` pulls Node-only deps (readline) into the browser bundle
 * and breaks the Vite build. We import core *types* only.
 */
import type { Ticket, CompletedSession } from '@claude-alive/core';

/** Bucketing granularity for the time-series charts. */
export type PeriodGranularity = 'day' | 'week' | 'month';

/** A summable bag of usage metrics. All fields are cumulative counts. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  /** cacheRead + cacheCreation, combined — the dashboard treats cache as one bucket. */
  cacheTokens: number;
  totalTokens: number;
  costUsd: number;
  /** API/turn count: session `apiCalls`, ticket `numTurns`, or 1 per delegation. */
  calls: number;
}

export interface ModelUsage extends UsageTotals {
  model: string;
  /** How many records (runs/sessions/delegations) fed this row. */
  records: number;
}

export interface PeriodBucket extends UsageTotals {
  /** Start-of-period epoch ms — the bucket key. */
  start: number;
  /** Display label: "07-23" (day), "07-21~" (week), "2026-07" (month). */
  label: string;
}

export interface UsageSummary {
  total: UsageTotals;
  /** Per-model totals, sorted by totalTokens descending. */
  byModel: ModelUsage[];
  /** Time-series buckets, ascending by start. */
  byDay: PeriodBucket[];
  byWeek: PeriodBucket[];
  byMonth: PeriodBucket[];
  /** Rolling totals relative to `now` (calendar day / week-from-Monday / month). */
  today: UsageTotals;
  thisWeek: UsageTotals;
  thisMonth: UsageTotals;
  /** Count of normalized records that contributed. */
  recordCount: number;
  /** Distinct model count. */
  modelCount: number;
  /** Earliest / latest record timestamp, or null when empty. */
  firstAt: number | null;
  lastAt: number | null;
}

/** One normalized usage event, source-agnostic. */
interface UsageRecord extends UsageTotals {
  at: number;
  model: string;
}

const UNKNOWN_MODEL = 'unknown';

export function emptyTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, costUsd: 0, calls: 0 };
}

function addInto(target: UsageTotals, r: UsageTotals): void {
  target.inputTokens += r.inputTokens;
  target.outputTokens += r.outputTokens;
  target.cacheTokens += r.cacheTokens;
  target.totalTokens += r.totalTokens;
  target.costUsd += r.costUsd;
  target.calls += r.calls;
}

const num = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Derive a totalTokens value: trust the explicit field, else sum the parts. */
function deriveTotal(input: number, output: number, cache: number, explicit?: number): number {
  const parts = input + output + cache;
  const e = num(explicit);
  return e > 0 ? e : parts;
}

/** Flatten tickets + sessions into normalized records. Records with no usable
 * timestamp are dropped (they cannot be bucketed). */
export function toRecords(tickets: readonly Ticket[], sessions: readonly CompletedSession[]): UsageRecord[] {
  const records: UsageRecord[] = [];

  for (const ticket of tickets) {
    const at = ticket.endedAt ?? ticket.startedAt ?? ticket.createdAt;
    // Main-agent usage — only if there's something to count.
    const u = ticket.usage;
    if (u && at != null) {
      const input = num(u.inputTokens);
      const output = num(u.outputTokens);
      const cache = num(u.cacheReadTokens) + num(u.cacheCreationTokens);
      const total = deriveTotal(input, output, cache, u.totalTokens);
      if (total > 0 || num(u.costUsd) > 0) {
        records.push({
          at,
          model: ticket.model ?? UNKNOWN_MODEL,
          inputTokens: input,
          outputTokens: output,
          cacheTokens: cache,
          totalTokens: total,
          costUsd: num(u.costUsd),
          calls: Math.max(1, num(u.numTurns)),
        });
      }
    }
    // Sub-agent delegations — each is its own model's usage.
    for (const d of ticket.delegations ?? []) {
      const input = num(d.inputTokens);
      const output = num(d.outputTokens);
      const total = deriveTotal(input, output, 0, d.totalTokens);
      if (total <= 0 && num(d.costUsd) <= 0) continue;
      records.push({
        at: d.at,
        model: d.model || UNKNOWN_MODEL,
        inputTokens: input,
        outputTokens: output,
        cacheTokens: 0,
        totalTokens: total,
        costUsd: num(d.costUsd),
        calls: 1,
      });
    }
  }

  for (const s of sessions) {
    const tu = s.tokenUsage;
    if (!tu || s.completedAt == null) continue;
    const input = num(tu.inputTokens);
    const output = num(tu.outputTokens);
    const cache = num(tu.cacheCreationTokens) + num(tu.cacheReadTokens);
    const total = deriveTotal(input, output, cache, tu.totalTokens);
    if (total <= 0) continue;
    records.push({
      at: s.completedAt,
      model: tu.model || UNKNOWN_MODEL,
      inputTokens: input,
      outputTokens: output,
      cacheTokens: cache,
      totalTokens: total,
      costUsd: 0, // completed sessions carry no cost
      calls: Math.max(0, num(tu.apiCalls)),
    });
  }

  return records;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday-based start of week. */
export function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  const dow = d.getDay(); // 0=Sun..6=Sat
  const deltaToMonday = (dow + 6) % 7; // Mon→0, Sun→6
  d.setDate(d.getDate() - deltaToMonday);
  return d.getTime();
}

export function startOfMonth(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

const pad = (n: number): string => String(n).padStart(2, '0');

function labelFor(granularity: PeriodGranularity, start: number): string {
  const d = new Date(start);
  if (granularity === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  // day + week both key off a specific date; week shows its Monday.
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function bucketStart(granularity: PeriodGranularity, ts: number): number {
  if (granularity === 'day') return startOfDay(ts);
  if (granularity === 'week') return startOfWeek(ts);
  return startOfMonth(ts);
}

function totalsOf(r: UsageRecord): UsageTotals {
  return {
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheTokens: r.cacheTokens,
    totalTokens: r.totalTokens,
    costUsd: r.costUsd,
    calls: r.calls,
  };
}

function bucketize(records: readonly UsageRecord[], granularity: PeriodGranularity): PeriodBucket[] {
  const map = new Map<number, PeriodBucket>();
  for (const r of records) {
    const start = bucketStart(granularity, r.at);
    let bucket = map.get(start);
    if (!bucket) {
      bucket = { start, label: labelFor(granularity, start), ...emptyTotals() };
      map.set(start, bucket);
    }
    addInto(bucket, totalsOf(r));
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

/**
 * Fold raw ticket + session arrays into a full usage summary.
 * `now` is injectable so tests are deterministic (default `Date.now()`).
 */
export function aggregateUsage(
  tickets: readonly Ticket[],
  sessions: readonly CompletedSession[],
  now: number = Date.now(),
): UsageSummary {
  const records = toRecords(tickets, sessions);

  const total = emptyTotals();
  const today = emptyTotals();
  const thisWeek = emptyTotals();
  const thisMonth = emptyTotals();
  const modelMap = new Map<string, ModelUsage>();

  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  let firstAt: number | null = null;
  let lastAt: number | null = null;

  for (const r of records) {
    const t = totalsOf(r);
    addInto(total, t);
    if (r.at >= todayStart) addInto(today, t);
    if (r.at >= weekStart) addInto(thisWeek, t);
    if (r.at >= monthStart) addInto(thisMonth, t);

    let row = modelMap.get(r.model);
    if (!row) {
      row = { model: r.model, records: 0, ...emptyTotals() };
      modelMap.set(r.model, row);
    }
    addInto(row, t);
    row.records += 1;

    if (firstAt === null || r.at < firstAt) firstAt = r.at;
    if (lastAt === null || r.at > lastAt) lastAt = r.at;
  }

  const byModel = [...modelMap.values()].sort(
    (a, b) => b.totalTokens - a.totalTokens || b.costUsd - a.costUsd || a.model.localeCompare(b.model),
  );

  return {
    total,
    byModel,
    byDay: bucketize(records, 'day'),
    byWeek: bucketize(records, 'week'),
    byMonth: bucketize(records, 'month'),
    today,
    thisWeek,
    thisMonth,
    recordCount: records.length,
    modelCount: modelMap.size,
    firstAt,
    lastAt,
  };
}

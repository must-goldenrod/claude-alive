import { describe, it, expect } from 'vitest';
import {
  parseDateInput,
  toDateInputValue,
  filterRecordsByRange,
  summarizeRecords,
} from '../views/data/usageAggregation.ts';

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime();

const rec = (ts: number, totalTokens: number, costUsd: number) => ({
  at: ts,
  model: 'opus',
  inputTokens: totalTokens,
  outputTokens: 0,
  cacheTokens: 0,
  totalTokens,
  costUsd,
  calls: 1,
});

describe('parseDateInput', () => {
  it('parses a day to local midnight and to the last millisecond of that day', () => {
    const start = parseDateInput('2026-07-23', 'start');
    const end = parseDateInput('2026-07-23', 'end');
    expect(start).toBe(new Date(2026, 6, 23, 0, 0, 0, 0).getTime());
    expect(end).toBe(new Date(2026, 6, 23, 23, 59, 59, 999).getTime());
  });

  it('treats empty and malformed input as unbounded (null)', () => {
    expect(parseDateInput('')).toBeNull();
    expect(parseDateInput(null)).toBeNull();
    expect(parseDateInput('2026-7-3')).toBeNull();
    expect(parseDateInput('not-a-date')).toBeNull();
  });

  it('rejects calendar dates that do not exist', () => {
    expect(parseDateInput('2026-02-31')).toBeNull();
    expect(parseDateInput('2026-13-01')).toBeNull();
  });

  it('round-trips through toDateInputValue', () => {
    const ts = at(2026, 7, 5, 23);
    expect(toDateInputValue(ts)).toBe('2026-07-05');
    expect(parseDateInput(toDateInputValue(ts), 'start')).toBe(new Date(2026, 6, 5).getTime());
  });
});

describe('filterRecordsByRange', () => {
  const records = [
    rec(at(2026, 7, 1), 100, 1),
    rec(at(2026, 7, 10), 200, 2),
    rec(at(2026, 7, 20), 400, 4),
  ];

  it('returns everything when both bounds are unbounded', () => {
    expect(filterRecordsByRange(records, null, null)).toHaveLength(3);
  });

  it('includes both boundary days (inclusive on each side)', () => {
    const from = parseDateInput('2026-07-01', 'start');
    const to = parseDateInput('2026-07-10', 'end');
    expect(filterRecordsByRange(records, from, to).map((r) => r.totalTokens)).toEqual([100, 200]);
  });

  it('supports a single open bound', () => {
    const from = parseDateInput('2026-07-10', 'start');
    expect(filterRecordsByRange(records, from, null).map((r) => r.totalTokens)).toEqual([200, 400]);
    const to = parseDateInput('2026-07-01', 'end');
    expect(filterRecordsByRange(records, null, to).map((r) => r.totalTokens)).toEqual([100]);
  });

  it('keeps a same-day range whole', () => {
    const from = parseDateInput('2026-07-10', 'start');
    const to = parseDateInput('2026-07-10', 'end');
    expect(filterRecordsByRange(records, from, to)).toHaveLength(1);
  });

  it('does not mutate the input array', () => {
    const copy = [...records];
    filterRecordsByRange(records, parseDateInput('2026-07-05', 'start'), null);
    expect(records).toEqual(copy);
  });
});

describe('summary over a filtered range', () => {
  it('totals/costs/calls reflect only the records inside the range', () => {
    const records = [
      rec(at(2026, 7, 1), 100, 1),
      rec(at(2026, 7, 10), 200, 2),
      rec(at(2026, 7, 20), 400, 4),
    ];
    const filtered = filterRecordsByRange(
      records,
      parseDateInput('2026-07-05', 'start'),
      parseDateInput('2026-07-20', 'end'),
    );
    const summary = summarizeRecords(filtered, at(2026, 7, 23));

    expect(summary.recordCount).toBe(2);
    expect(summary.total.totalTokens).toBe(600);
    expect(summary.total.costUsd).toBe(6);
    expect(summary.total.calls).toBe(2);
    expect(summary.byModel[0]?.totalTokens).toBe(600);
    expect(summary.byDay.map((b) => b.totalTokens)).toEqual([200, 400]);
    expect(summary.firstAt).toBe(at(2026, 7, 10));
    expect(summary.lastAt).toBe(at(2026, 7, 20));
  });
});

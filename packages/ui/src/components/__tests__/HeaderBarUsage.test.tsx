import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { UsageLimitsSnapshot } from '@claude-alive/core';
import { HeaderBar } from '../HeaderBar.tsx';

const usage: UsageLimitsSnapshot = {
  fiveHour: { utilization: 0.09, resetsAt: null },
  sevenDay: { utilization: 0.08, resetsAt: null },
  scopedWeekly: [{ modelName: 'Fable', utilization: 0.0, resetsAt: null }],
  fetchedAt: 0,
  stale: false,
};

const renderHeader = (usageLimits: UsageLimitsSnapshot | null) =>
  render(
    <HeaderBar viewMode="tickets" onViewModeChange={() => {}} usageLimits={usageLimits} />,
  );

// vitest runs without `globals`, so RTL's auto-cleanup never registers.
afterEach(cleanup);

describe('HeaderBar usage pills', () => {
  it('renders one pill per reported window', () => {
    renderHeader(usage);
    expect(screen.getByText('5H')).toBeDefined();
    expect(screen.getByText('7D')).toBeDefined();
    expect(screen.getByText('FABLE')).toBeDefined();
    expect(screen.getByText('9%')).toBeDefined();
  });

  it('renders no usage pills before the first poll lands', () => {
    renderHeader(null);
    expect(screen.queryByText('5H')).toBeNull();
    expect(screen.queryByText('7D')).toBeNull();
  });
});

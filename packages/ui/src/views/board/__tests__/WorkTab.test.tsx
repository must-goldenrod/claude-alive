import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TicketEvaluation } from '@claude-alive/core';
import { TicketList } from '../TicketList';

const rec = (overrides: Partial<TicketEvaluation>): TicketEvaluation => ({
  ticketId: 't1',
  seq: 1,
  route: '/proj/a',
  goal: 'goal',
  label: 'good',
  autoLabel: 'good',
  humanLabeled: false,
  reflected: false,
  weight: 3,
  updatedAt: 100,
  createdAt: 100,
  ...overrides,
} as TicketEvaluation);

afterEach(cleanup);

describe('TicketList', () => {
  it('groups by route and fires onSelect', () => {
    const onSelect = vi.fn();
    render(
      <TicketList
        records={[rec({ ticketId: 't1', headline: 'Hello' })]}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByText('Hello'));
    expect(onSelect).toHaveBeenCalledWith('t1');
  });

  it('shows loading when records null', () => {
    render(<TicketList records={null} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/loading|불러오는/i)).toBeInTheDocument();
  });
});

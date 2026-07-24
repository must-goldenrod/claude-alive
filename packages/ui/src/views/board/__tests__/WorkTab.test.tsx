import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('searches goal, headline, and route fields', () => {
    render(
      <TicketList
        records={[
          rec({ ticketId: 'goal', route: '/proj/alpha', goal: 'Authentication flow', headline: 'Goal match' }),
          rec({ ticketId: 'headline', route: '/proj/beta', goal: 'Other goal', headline: 'Database card' }),
          rec({ ticketId: 'route', route: '/proj/needle-route', goal: 'Another goal', headline: 'Route match' }),
        ]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    const search = screen.getByRole('textbox');
    fireEvent.change(search, { target: { value: 'authentication' } });
    expect(screen.getByText('Goal match')).toBeInTheDocument();
    expect(screen.queryByText('Database card')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'database' } });
    expect(screen.getByText('Database card')).toBeInTheDocument();
    expect(screen.queryByText('Goal match')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'needle-route' } });
    expect(screen.getByText('Route match')).toBeInTheDocument();
    expect(screen.queryByText('Database card')).not.toBeInTheDocument();
  });

  it('renders route groups, counts, reflected badge, selection, and label semantics', () => {
    render(
      <TicketList
        records={[
          rec({ ticketId: 'good', route: '/proj/alpha', headline: 'Good ticket', label: 'good', reflected: true, updatedAt: 300 }),
          rec({ ticketId: 'bad', route: '/proj/alpha', headline: 'Bad ticket', label: 'bad', updatedAt: 200 }),
          rec({ ticketId: 'unrated', route: '/proj/beta', headline: 'Unrated ticket', label: 'unrated', updatedAt: 100 }),
        ]}
        selectedId="good"
        onSelect={() => {}}
      />,
    );

    const alpha = screen.getByRole('button', { name: /alpha/i });
    const beta = screen.getByRole('button', { name: /beta/i });
    expect(alpha).toBeInTheDocument();
    expect(beta).toBeInTheDocument();
    expect(within(alpha).getByText(/2\s+(total|전체)/i)).toBeInTheDocument();
    expect(within(alpha).getByText(/1\s+good/i)).toBeInTheDocument();
    expect(within(alpha).getByText(/1\s+bad/i)).toBeInTheDocument();
    expect(within(alpha).getByText(/1\s+(reflected|반영됨)/i)).toBeInTheDocument();

    const goodTicket = screen.getByRole('button', { name: /good ticket/i });
    const badTicket = screen.getByRole('button', { name: /bad ticket/i });
    const unratedTicket = screen.getByRole('button', { name: /unrated ticket/i });
    expect(within(goodTicket).getByText(/reflected|반영됨/i)).toBeInTheDocument();
    expect(goodTicket).toHaveAttribute('aria-pressed', 'true');
    expect(badTicket).toHaveAttribute('aria-pressed', 'false');
    expect(unratedTicket).toHaveAttribute('aria-pressed', 'false');
    expect(within(goodTicket).getByRole('img', { name: /good/i })).toBeInTheDocument();
    expect(within(badTicket).getByRole('img', { name: /bad/i })).toBeInTheDocument();
    expect(within(unratedTicket).getByRole('img', { name: /unrated|미평가/i })).toBeInTheDocument();
  });

  it('exposes route collapse state and toggles its tickets', () => {
    render(
      <TicketList
        records={[rec({ route: '/proj/alpha', headline: 'Collapsible ticket' })]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    const group = screen.getByRole('button', { name: /alpha/i });
    expect(group).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Collapsible ticket')).not.toBeInTheDocument();
    fireEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Collapsible ticket')).toBeInTheDocument();
  });
});

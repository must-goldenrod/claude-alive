import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { BoardView } from '../BoardView';

const noopSub = () => () => {};

afterEach(cleanup);

describe('BoardView', () => {
  it('renders work and cost top tabs, work active by default', () => {
    render(<BoardView active subscribeRaw={noopSub} />);
    expect(screen.getByRole('tab', { name: /work|작업/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /cost|비용/i })).toBeInTheDocument();
  });

  it('switches to cost tab on click', () => {
    render(<BoardView active subscribeRaw={noopSub} />);
    fireEvent.click(screen.getByRole('tab', { name: /cost|비용/i }));
    expect(screen.getByRole('tab', { name: /cost|비용/i })).toHaveAttribute('aria-selected', 'true');
  });
});

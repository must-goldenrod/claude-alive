import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { BoardView } from '../BoardView';

vi.mock('../WorkTab.tsx', () => ({
  WorkTab: ({ active }: { active: boolean }) => (
    <div data-testid="work-view" data-active={String(active)} />
  ),
}));

vi.mock('../../data/DataView.tsx', () => ({
  DataView: ({ active }: { active: boolean }) => (
    <div data-testid="cost-view" data-active={String(active)} />
  ),
}));

const noopSub = () => () => {};

afterEach(cleanup);

describe('BoardView', () => {
  it('renders work and cost top tabs, work active by default', () => {
    render(<BoardView active subscribeRaw={noopSub} />);
    const workTab = screen.getByRole('tab', { name: /work|작업/i });
    const costTab = screen.getByRole('tab', { name: /cost|비용/i });
    expect(workTab).toHaveAttribute('aria-selected', 'true');
    expect(workTab).toHaveAttribute('aria-controls', 'board-panel-work');
    expect(workTab).toHaveAttribute('tabindex', '0');
    expect(costTab).toHaveAttribute('aria-controls', 'board-panel-cost');
    expect(costTab).toHaveAttribute('tabindex', '-1');

    const workPanel = document.getElementById('board-panel-work');
    const costPanel = document.getElementById('board-panel-cost');
    expect(workPanel).toHaveAttribute('role', 'tabpanel');
    expect(workPanel).toHaveAttribute('aria-labelledby', 'board-tab-work');
    expect(costPanel).toHaveAttribute('role', 'tabpanel');
    expect(costPanel).toHaveAttribute('aria-labelledby', 'board-tab-cost');
    expect(screen.getByTestId('work-view')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('cost-view')).toHaveAttribute('data-active', 'false');
  });

  it('switches to cost tab on click', () => {
    render(<BoardView active subscribeRaw={noopSub} />);
    fireEvent.click(screen.getByRole('tab', { name: /cost|비용/i }));
    expect(screen.getByRole('tab', { name: /cost|비용/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('work-view')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('cost-view')).toHaveAttribute('data-active', 'true');
  });

  it('moves and activates top tabs with wrapping arrow-key navigation', () => {
    render(<BoardView active subscribeRaw={noopSub} />);
    const workTab = screen.getByRole('tab', { name: /work|작업/i });
    const costTab = screen.getByRole('tab', { name: /cost|비용/i });

    workTab.focus();
    fireEvent.keyDown(workTab, { key: 'ArrowRight' });
    expect(costTab).toHaveFocus();
    expect(costTab).toHaveAttribute('aria-selected', 'true');
    expect(costTab).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(costTab, { key: 'ArrowRight' });
    expect(workTab).toHaveFocus();
    expect(workTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(workTab, { key: 'ArrowLeft' });
    expect(costTab).toHaveFocus();
    expect(costTab).toHaveAttribute('aria-selected', 'true');
  });
});

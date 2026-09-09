import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { PullToRefresh, PULL_THRESHOLD } from '../PullToRefresh.tsx';

afterEach(cleanup);

const touch = (y: number) => ({ touches: [{ clientY: y, clientX: 0 }] });

function pull(el: HTMLElement, distance: number) {
  fireEvent.touchStart(el, touch(0));
  fireEvent.touchMove(el, touch(distance));
  fireEvent.touchEnd(el, { changedTouches: [{ clientY: distance, clientX: 0 }] });
}

describe('PullToRefresh', () => {
  it('refreshes when pulled past the threshold from the top', async () => {
    const onRefresh = vi.fn(async () => {});
    render(<PullToRefresh onRefresh={onRefresh}><p>내용</p></PullToRefresh>);
    pull(screen.getByTestId('pull-scroll'), PULL_THRESHOLD + 20);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('does not refresh on a short pull — that is a scroll that changed its mind', async () => {
    const onRefresh = vi.fn(async () => {});
    render(<PullToRefresh onRefresh={onRefresh}><p>내용</p></PullToRefresh>);
    pull(screen.getByTestId('pull-scroll'), PULL_THRESHOLD - 10);
    await new Promise((r) => setTimeout(r, 30));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does not refresh when the list is scrolled down', async () => {
    const onRefresh = vi.fn(async () => {});
    render(<PullToRefresh onRefresh={onRefresh}><p>내용</p></PullToRefresh>);
    const el = screen.getByTestId('pull-scroll');
    // Half-way down a list, a downward drag is a scroll, not a refresh.
    Object.defineProperty(el, 'scrollTop', { value: 250, configurable: true });
    pull(el, PULL_THRESHOLD + 40);
    await new Promise((r) => setTimeout(r, 30));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('ignores an upward drag', async () => {
    const onRefresh = vi.fn(async () => {});
    render(<PullToRefresh onRefresh={onRefresh}><p>내용</p></PullToRefresh>);
    pull(screen.getByTestId('pull-scroll'), -80);
    await new Promise((r) => setTimeout(r, 30));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('says what will happen as the pull crosses the threshold', () => {
    render(<PullToRefresh onRefresh={vi.fn()}><p>내용</p></PullToRefresh>);
    const el = screen.getByTestId('pull-scroll');
    fireEvent.touchStart(el, touch(0));
    fireEvent.touchMove(el, touch(20));
    expect(screen.getByText(/당겨서|Pull to/)).toBeInTheDocument();
    fireEvent.touchMove(el, touch(PULL_THRESHOLD + 10));
    expect(screen.getByText(/놓으면|Release/)).toBeInTheDocument();
  });

  it('renders its children', () => {
    render(<PullToRefresh onRefresh={vi.fn()}><p>목록 내용</p></PullToRefresh>);
    expect(screen.getByText('목록 내용')).toBeInTheDocument();
  });

  it('is inert without a refresh handler, so a screen with nothing to refetch opts out', async () => {
    render(<PullToRefresh><p>내용</p></PullToRefresh>);
    const el = screen.getByTestId('pull-scroll');
    fireEvent.touchStart(el, touch(0));
    fireEvent.touchMove(el, touch(PULL_THRESHOLD + 40));
    expect(screen.queryByText(/당겨서|Pull to/)).not.toBeInTheDocument();
  });
});

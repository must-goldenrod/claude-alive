import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '@claude-alive/core';
import { RunCard } from '../components/RunCard.tsx';

const RUN: Run = {
  runId: 'ticket:t1', repoId: 'r1', worktreeId: 'w1', kind: 'ticket', sourceId: 't1',
  title: '위임 모델 확장', state: 'waiting', startedAt: 1000,
  meta: { seq: 12, headline: '12종 등록 완료', model: 'claude-opus-4-8', costUsd: 0.42 },
};

afterEach(cleanup);

function setup(run: Run = RUN) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const onAbandon = vi.fn();
  render(<RunCard run={run} onOpen={onOpen} onClose={onClose} onAbandon={onAbandon} />);
  return { onOpen, onClose, onAbandon };
}

describe('RunCard', () => {
  it('shows the sequence number, title and headline', () => {
    setup();
    expect(screen.getByText(/#12/)).toBeInTheDocument();
    expect(screen.getByText('위임 모델 확장')).toBeInTheDocument();
    expect(screen.getByText('12종 등록 완료')).toBeInTheDocument();
  });

  it('prefills the close input with the headline', () => {
    setup();
    fireEvent.click(screen.getByTestId('run-close'));
    expect(screen.getByTestId('run-outcome')).toHaveValue('12종 등록 완료');
  });

  it('submits the outcome on Enter', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId('run-close'));
    const input = screen.getByTestId('run-outcome');
    fireEvent.change(input, { target: { value: '폴백 검증까지 완료' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledWith('ticket:t1', '폴백 검증까지 완료');
  });

  it('ignores Enter while an IME composition is in flight', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId('run-close'));
    const input = screen.getByTestId('run-outcome');
    fireEvent.change(input, { target: { value: '한글' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true } as unknown as KeyboardEventInit);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses to submit an empty outcome', () => {
    const { onClose } = setup({ ...RUN, meta: { seq: 12 } });
    fireEvent.click(screen.getByTestId('run-close'));
    fireEvent.keyDown(screen.getByTestId('run-outcome'), { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('abandon needs no outcome', () => {
    const { onAbandon } = setup();
    fireEvent.click(screen.getByTestId('run-close'));
    fireEvent.click(screen.getByTestId('run-abandon'));
    expect(onAbandon).toHaveBeenCalledWith('ticket:t1');
  });

  it('a closed run shows its outcome and offers no close button', () => {
    setup({ ...RUN, state: 'closed', outcome: '기록됨', closedAt: 2000 });
    expect(screen.getByText('기록됨')).toBeInTheDocument();
    expect(screen.queryByTestId('run-close')).not.toBeInTheDocument();
  });

  it('open dispatches with the whole run', () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByTestId('run-open'));
    expect(onOpen).toHaveBeenCalledWith(RUN);
  });
  it('states the run state in words, not just a colour', () => {
    setup();
    expect(screen.getByText(/확인 필요|Needs you/)).toBeInTheDocument();
  });

  it('shortens the model to its family', () => {
    setup();
    expect(screen.getByText(/opus/)).toBeInTheDocument();
    expect(screen.queryByText(/claude-opus-4-8/)).not.toBeInTheDocument();
  });

  it('marks the run kind with an icon', () => {
    setup();
    expect(screen.getByTestId('hierarchy-icon-ticket')).toBeInTheDocument();
  });

  it('offers an explicit submit as well as Enter', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId('run-close'));
    fireEvent.change(screen.getByTestId('run-outcome'), { target: { value: '버튼으로 제출' } });
    fireEvent.click(screen.getByTestId('run-outcome-submit'));
    expect(onClose).toHaveBeenCalledWith('ticket:t1', '버튼으로 제출');
  });

  it('disables the submit button while the outcome is blank', () => {
    setup({ ...RUN, meta: { seq: 12 } });
    fireEvent.click(screen.getByTestId('run-close'));
    expect(screen.getByTestId('run-outcome-submit').closest('button')).toBeDisabled();
  });
  it('lists the files the run wrote to, by name', () => {
    setup({ ...RUN, touchedFiles: ['/r/proj/packages/ui/src/App.tsx', '/r/proj/README.md'] });
    expect(screen.getByText('App.tsx')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('counts the changed files so the total reads without expanding', () => {
    setup({ ...RUN, touchedFiles: ['/a.ts', '/b.ts', '/c.ts'] });
    expect(screen.getByTestId('touched-count')).toHaveTextContent('3');
  });

  it('caps the visible list and says how many more there are', () => {
    const files = Array.from({ length: 9 }, (_, i) => `/f${i}.ts`);
    setup({ ...RUN, touchedFiles: files });
    expect(screen.getByTestId('touched-more')).toHaveTextContent('4');
  });

  it('shows no file section when the run wrote nothing', () => {
    setup();
    expect(screen.queryByTestId('touched-count')).not.toBeInTheDocument();
  });
});

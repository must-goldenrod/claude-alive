import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MobileSpawnPicker } from '../MobileSpawnPicker.tsx';

afterEach(cleanup);

const projects = [
  { path: '/Users/me/work/app', name: 'app' },
  { path: '/Users/me/work/site', name: 'site' },
];

describe('MobileSpawnPicker', () => {
  it('starts a shell in the project that was tapped', () => {
    const onSpawn = vi.fn();
    render(<MobileSpawnPicker projects={projects} onCancel={() => {}} onSpawn={onSpawn} />);
    fireEvent.click(screen.getByRole('button', { name: 'site' }));
    expect(onSpawn).toHaveBeenCalledWith('/Users/me/work/site');
  });

  it('cancels back', () => {
    const onCancel = vi.fn();
    render(<MobileSpawnPicker projects={projects} onCancel={onCancel} onSpawn={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /뒤로|Back/ }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('explains when there is nowhere it may run', () => {
    render(<MobileSpawnPicker projects={[]} onCancel={() => {}} onSpawn={vi.fn()} />);
    expect(screen.getByText(/CLAUDE_ALIVE_TICKET_ROOTS/)).toBeInTheDocument();
  });
});

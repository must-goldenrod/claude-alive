import '@claude-alive/i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AgentInfo } from '@claude-alive/core';
import { ProjectSidebar } from '../ProjectSidebar.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const agent = {
  id: 's-1',
  sessionId: 's-1',
  state: 'active',
  currentTool: 'Edit',
  currentToolAnimation: null,
  cwd: '/Users/dev/projects/shop-web',
  lastEvent: 'PreToolUse',
  lastEventTime: 0,
  parentId: null,
  createdAt: 0,
  displayName: null,
  projectName: 'shop-web',
  transcriptPath: null,
  totalEvents: 1,
  lastPrompt: null,
  toolsUsed: [],
  toolCallCount: 0,
  toolCallCounts: {},
  tokenUsage: null,
  inputTokens: 0,
} as unknown as AgentInfo;

describe('ProjectSidebar avatars', () => {
  it('draws pixel avatars by default (animation view)', () => {
    // jsdom has no 2D canvas; the sprite painter only needs calls to succeed.
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,');
    render(<ProjectSidebar agents={[agent]} />);
    expect(screen.getAllByTestId('agent-avatar')).toHaveLength(1);
  });

  it('keeps only the state dot when avatars are off (list view)', () => {
    render(<ProjectSidebar agents={[agent]} showAvatars={false} />);
    expect(screen.queryByTestId('agent-avatar')).toBeNull();
    expect(screen.getAllByTestId('agent-state-dot')).toHaveLength(1);
    expect(document.querySelector('img')).toBeNull();
  });
});

import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EfficioAxisKey,
  EfficioAxisScore,
  EfficioSessionProfile,
  TicketEvaluation,
} from '@claude-alive/core';
import { TicketDetailTabs } from '../TicketDetailTabs.tsx';
import { EfficiencyPanel } from '../panels/EfficiencyPanel.tsx';
import { ProcessPanel } from '../panels/ProcessPanel.tsx';
import { QualityPanel } from '../panels/QualityPanel.tsx';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function prompt(id: string, sessionId: string, text = `prompt-${id}`) {
  return {
    id,
    session_id: sessionId,
    prompt: text,
    char_len: text.length,
    word_count: 1,
    created_at: '2026-07-24T00:00:00.000Z',
    turn_index: 1,
    final_score: 0.8,
    rule_score: 0.7,
    usage_score: 0.9,
    tier: 'good',
  };
}

const AXIS_KEYS = ['w2', 'wc', 'bash', 'w3'] as const satisfies readonly EfficioAxisKey[];

function efficiencyProfile(
  sessionId: string,
  title = `profile-${sessionId}`,
): EfficioSessionProfile {
  const score: EfficioAxisScore = {
    actual: 10,
    baseline: 8,
    residual: 2,
    wastePercentile: 75,
    isZero: false,
  };
  const axes = Object.fromEntries(
    AXIS_KEYS.map((key) => [key, { ...score }]),
  ) as Record<EfficioAxisKey, EfficioAxisScore>;
  return {
    sessionId,
    title,
    project: 'project',
    tsFirst: 1,
    turns: 2,
    totalTokens: 300,
    cacheCreation: 10,
    cacheRead: 20,
    axes,
    topBash: [],
    topEdits: [],
  };
}

function completedSession(sessionId: string, displayName = `run-${sessionId}`) {
  return {
    sessionId,
    cwd: '/project',
    projectName: 'project',
    completedAt: 2_000,
    createdAt: 1_000,
    durationMs: 1_000,
    finalState: 'done',
    totalEvents: 3,
    toolCallCount: 1,
    toolsUsed: ['Read'],
    lastPrompt: `last-${sessionId}`,
    displayName,
  };
}

const ticket = {
  ticketId: 'ticket-1',
  seq: 1,
  route: '/project',
  goal: 'goal',
  label: 'good',
  autoLabel: 'good',
  humanLabeled: false,
  reflected: false,
  weight: 3,
  updatedAt: 1,
  createdAt: 1,
} as TicketEvaluation;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch');
});

describe.each([
  ['QualityPanel', QualityPanel],
  ['EfficiencyPanel', EfficiencyPanel],
  ['ProcessPanel', ProcessPanel],
] as const)('%s join states', (_name, Panel) => {
  it('does not fetch and shows the translated no-session state without a session id', () => {
    render(<Panel sessionId={null} />);

    expect(screen.getByText(/no linked session|연결된 세션 없음/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the translated no-data state when the request fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network'));
    render(<Panel sessionId="S" />);

    expect(await screen.findByText(/no data|데이터 없음/i)).toBeInTheDocument();
  });
});

describe('QualityPanel', () => {
  it('renders only prompts joined by session_id from the real response envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ prompts: [prompt('match', 'S'), prompt('other', 'OTHER')] }),
    );

    render(<QualityPanel sessionId="S" />);

    expect(await screen.findByText('prompt-match')).toBeInTheDocument();
    expect(screen.queryByText('prompt-other')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/prompts?limit=1000',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('shows no data when no prompt matches', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ prompts: [prompt('other', 'OTHER')] }),
    );

    render(<QualityPanel sessionId="S" />);

    expect(await screen.findByText(/no data|데이터 없음/i)).toBeInTheDocument();
  });

  it('ignores an older response after the session changes', async () => {
    const first = deferred<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(jsonResponse({ prompts: [prompt('new', 'NEW')] }));
    const { rerender } = render(<QualityPanel sessionId="OLD" />);

    rerender(<QualityPanel sessionId="NEW" />);
    expect(await screen.findByText('prompt-new')).toBeInTheDocument();

    await act(async () => {
      first.resolve(jsonResponse({ prompts: [prompt('old', 'OLD')] }));
      await first.promise;
    });
    await waitFor(() => expect(screen.queryByText('prompt-old')).not.toBeInTheDocument());
    expect(screen.getByText('prompt-new')).toBeInTheDocument();
  });
});

describe('EfficiencyPanel', () => {
  it('renders the matching profile through SessionDetailCard', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        modelVersion: 1,
        sessions: [
          efficiencyProfile('OTHER', 'other-profile'),
          efficiencyProfile('S', 'matching-profile'),
        ],
      }),
    );

    render(<EfficiencyPanel sessionId="S" />);

    expect(await screen.findByText('matching-profile')).toBeInTheDocument();
    expect(screen.queryByText('other-profile')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/efficio\/profiles\?last=1000$/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('shows no data when no profile matches', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ modelVersion: null, sessions: [efficiencyProfile('OTHER')] }),
    );

    render(<EfficiencyPanel sessionId="S" />);

    expect(await screen.findByText(/no data|데이터 없음/i)).toBeInTheDocument();
  });

  it('ignores an older response after the session changes', async () => {
    const first = deferred<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        jsonResponse({
          modelVersion: 1,
          sessions: [efficiencyProfile('NEW', 'new-profile')],
        }),
      );
    const { rerender } = render(<EfficiencyPanel sessionId="OLD" />);

    rerender(<EfficiencyPanel sessionId="NEW" />);
    expect(await screen.findByText('new-profile')).toBeInTheDocument();

    await act(async () => {
      first.resolve(
        jsonResponse({
          modelVersion: 1,
          sessions: [efficiencyProfile('OLD', 'old-profile')],
        }),
      );
      await first.promise;
    });
    await waitFor(() => expect(screen.queryByText('old-profile')).not.toBeInTheDocument());
    expect(screen.getByText('new-profile')).toBeInTheDocument();
  });
});

describe('ProcessPanel', () => {
  it('renders only the completed session joined by sessionId', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        sessions: [
          completedSession('OTHER', 'Other run'),
          completedSession('S', 'Matching run'),
        ],
      }),
    );

    render(<ProcessPanel sessionId="S" />);

    expect(await screen.findByText('Matching run')).toBeInTheDocument();
    expect(screen.queryByText('Other run')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/completed\?limit=1000$/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('shows no data when no completed session matches', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ sessions: [completedSession('OTHER')] }),
    );

    render(<ProcessPanel sessionId="S" />);

    expect(await screen.findByText(/no data|데이터 없음/i)).toBeInTheDocument();
  });

  it('ignores an older response after the session changes', async () => {
    const first = deferred<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        jsonResponse({ sessions: [completedSession('NEW', 'New run')] }),
      );
    const { rerender } = render(<ProcessPanel sessionId="OLD" />);

    rerender(<ProcessPanel sessionId="NEW" />);
    expect(await screen.findByText('New run')).toBeInTheDocument();

    await act(async () => {
      first.resolve(jsonResponse({ sessions: [completedSession('OLD', 'Old run')] }));
      await first.promise;
    });
    await waitFor(() => expect(screen.queryByText('Old run')).not.toBeInTheDocument());
    expect(screen.getByText('New run')).toBeInTheDocument();
  });
});

it.each([
  ['QualityPanel', QualityPanel],
  ['EfficiencyPanel', EfficiencyPanel],
  ['ProcessPanel', ProcessPanel],
] as const)('%s aborts its request when unmounted', async (_name, Panel) => {
  const pending = deferred<Response>();
  vi.mocked(fetch).mockReturnValueOnce(pending.promise);
  const { unmount } = render(<Panel sessionId="S" />);
  const options = vi.mocked(fetch).mock.calls[0]?.[1];
  const signal = options?.signal;

  expect(signal?.aborted).toBe(false);
  unmount();
  expect(signal?.aborted).toBe(true);
});

it('TicketDetailTabs mounts each joined panel from its sub-tab', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(jsonResponse({ prompts: [prompt('quality', 'S')] }))
    .mockResolvedValueOnce(
      jsonResponse({
        modelVersion: 1,
        sessions: [efficiencyProfile('S', 'efficiency-match')],
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({ sessions: [completedSession('S', 'process-match')] }),
    );
  render(
    <TicketDetailTabs
      record={ticket}
      sessionId="S"
      guideRefreshKey={0}
      onLabel={vi.fn()}
      onReflect={vi.fn()}
      initialSubTab="quality"
    />,
  );

  expect(await screen.findByText('prompt-quality')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: /efficiency|효율/i }));
  expect(await screen.findByText('efficiency-match')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: /process|과정/i }));
  expect(await screen.findByText('process-match')).toBeInTheDocument();
});

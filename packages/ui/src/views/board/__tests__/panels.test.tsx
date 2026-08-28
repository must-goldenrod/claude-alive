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
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, false));
});

describe.each([
  ['QualityPanel', QualityPanel, /loading|불러오는 중/i],
  ['EfficiencyPanel', EfficiencyPanel, /loading|불러오는 중/i],
  ['ProcessPanel', ProcessPanel, /loading|불러오는 중/i],
] as const)('%s join states', (_name, Panel, loadingText) => {
  it('does not fetch and shows the translated no-session state without a session id', () => {
    render(<Panel sessionId={null} />);

    expect(screen.getByText(/no linked session|연결된 세션 없음/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows loading while pending, then no data after the request fails', async () => {
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    render(<Panel sessionId="S" />);

    expect(screen.getByText(loadingText)).toBeInTheDocument();
    await act(async () => {
      pending.reject(new Error('network'));
      await expect(pending.promise).rejects.toThrow('network');
    });
    expect(await screen.findByText(/no data|데이터 없음/i)).toBeInTheDocument();
  });
});

describe('QualityPanel', () => {
  it('renders only prompts joined by session_id from the real filtered endpoint', async () => {
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);

    render(<QualityPanel sessionId="S /?한글" />);

    expect(screen.getByText(/loading|불러오는 중/i)).toBeInTheDocument();
    await act(async () => {
      pending.resolve(
        jsonResponse({
          prompts: [
            prompt('match', 'S /?한글'),
            prompt('other', 'OTHER'),
          ],
        }),
      );
      await pending.promise;
    });
    expect(await screen.findByText('prompt-match')).toBeInTheDocument();
    expect(screen.queryByText('prompt-other')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      `/api/prompts?limit=500&session_id=${encodeURIComponent('S /?한글')}`,
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

  it('ignores malformed rows from unrelated sessions', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        prompts: [
          { session_id: 'OTHER' },
          prompt('valid-target', 'S'),
        ],
      }),
    );

    render(<QualityPanel sessionId="S" />);

    expect(await screen.findByText('prompt-valid-target')).toBeInTheDocument();
  });

  it('selects a filtered prompt and renders its full detail and rule hits', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/prompts?')) {
        return jsonResponse({
          prompts: [
            prompt('first', 'S', 'First filtered prompt'),
            prompt('second', 'S', 'Second filtered prompt'),
          ],
        });
      }
      if (url.endsWith('/api/prompts/second')) {
        return jsonResponse({
          prompt: {
            ...prompt('second', 'S', 'Second filtered prompt detail'),
            coach_context: 'Coach this prompt',
            judge_score: 0.7,
            computed_at: '2026-07-24T00:01:00.000Z',
            rules_version: 1,
          },
          hits: [
            {
              rule_id: 'R-DETAIL',
              severity: 5,
              message: 'Add an explicit acceptance criterion',
              evidence: 'missing criterion',
            },
          ],
        });
      }
      return jsonResponse({}, false);
    });

    render(<QualityPanel sessionId="S" />);

    fireEvent.click(
      await screen.findByRole('button', { name: /second filtered prompt/i }),
    );
    expect(await screen.findByText('Second filtered prompt detail')).toBeInTheDocument();
    expect(screen.getByText('R-DETAIL')).toBeInTheDocument();
    expect(screen.getByText('Add an explicit acceptance criterion')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/prompts/second',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
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
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);

    render(<EfficiencyPanel sessionId="S" />);

    expect(screen.getByText(/loading|불러오는 중/i)).toBeInTheDocument();
    await act(async () => {
      pending.resolve(
        jsonResponse({
          modelVersion: 1,
          sessions: [
            efficiencyProfile('OTHER', 'other-profile'),
            efficiencyProfile('S', 'matching-profile'),
          ],
        }),
      );
      await pending.promise;
    });
    expect(await screen.findByText('matching-profile')).toBeInTheDocument();
    expect(screen.queryByText('other-profile')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `/api/efficio/profiles\\?session_id=${encodeURIComponent('S')}$`,
        ),
      ),
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

  it('ignores malformed profiles from unrelated sessions', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        modelVersion: 1,
        sessions: [
          { sessionId: 'OTHER' },
          efficiencyProfile('S', 'valid-target-profile'),
        ],
      }),
    );

    render(<EfficiencyPanel sessionId="S" />);

    expect(await screen.findByText('valid-target-profile')).toBeInTheDocument();
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
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);

    render(<ProcessPanel sessionId="S" />);

    expect(screen.getByText(/loading|불러오는 중/i)).toBeInTheDocument();
    await act(async () => {
      pending.resolve(
        jsonResponse({
          sessions: [
            completedSession('OTHER', 'Other run'),
            completedSession('S', 'Matching run'),
          ],
        }),
      );
      await pending.promise;
    });
    expect(await screen.findByText('Matching run')).toBeInTheDocument();
    expect(screen.queryByText('Other run')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/completed\?limit=2000$/),
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

  it('ignores malformed unrelated rows and degrades a legacy target safely', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        sessions: [
          { sessionId: 'OTHER', tokenUsage: 'invalid' },
          { sessionId: 'S', displayName: 'Legacy matching run' },
        ],
      }),
    );

    render(<ProcessPanel sessionId="S" />);

    expect(await screen.findByText('Legacy matching run')).toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
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
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/prompts?')) {
      return jsonResponse({ prompts: [prompt('quality', 'S')] });
    }
    if (url.includes('/api/efficio/profiles?')) {
      return jsonResponse({
        modelVersion: 1,
        sessions: [efficiencyProfile('S', 'efficiency-match')],
      });
    }
    if (url.includes('/api/completed?')) {
      return jsonResponse({ sessions: [completedSession('S', 'process-match')] });
    }
    return jsonResponse({}, false);
  });
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
  expect(
    vi.mocked(fetch).mock.calls.some(([input]) =>
      String(input).includes('/api/efficio/profiles?'),
    ),
  ).toBe(false);
  expect(
    vi.mocked(fetch).mock.calls.some(([input]) =>
      String(input).includes('/api/completed?'),
    ),
  ).toBe(false);

  fireEvent.click(screen.getByRole('tab', { name: /efficiency|효율/i }));
  expect(await screen.findByText('efficiency-match')).toBeInTheDocument();
  expect(
    vi.mocked(fetch).mock.calls.some(([input]) =>
      String(input).includes('/api/completed?'),
    ),
  ).toBe(false);

  fireEvent.click(screen.getByRole('tab', { name: /process|과정/i }));
  expect(await screen.findByText('process-match')).toBeInTheDocument();
});

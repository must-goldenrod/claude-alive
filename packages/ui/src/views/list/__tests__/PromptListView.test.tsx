import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { PromptListView } from '../PromptListView.tsx';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function prompt(id: string, text: string) {
  return {
    id,
    session_id: 'S',
    prompt: text,
    char_len: text.length,
    word_count: 2,
    created_at: '2026-07-24T00:00:00.000Z',
    turn_index: 1,
    final_score: 80,
    rule_score: 70,
    usage_score: 90,
    tier: 'good',
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('preserves list selection and full prompt detail rendering', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/prompts?')) {
      return jsonResponse({
        prompts: [
          prompt('first', 'First prompt'),
          prompt('second', 'Second prompt'),
        ],
      });
    }
    if (url.endsWith('/api/prompts/second')) {
      return jsonResponse({
        prompt: {
          ...prompt('second', 'Selected prompt detail'),
          coach_context: 'Coaching context',
          judge_score: 75,
          computed_at: '2026-07-24T00:01:00.000Z',
          rules_version: 1,
        },
        hits: [
          {
            rule_id: 'R-2',
            severity: 4,
            message: 'Clarify the desired output',
            evidence: 'ambiguous output',
          },
        ],
      });
    }
    return jsonResponse({}, false);
  });

  render(<PromptListView active />);

  fireEvent.click(await screen.findByRole('button', { name: /second prompt/i }));
  expect(await screen.findByText('Selected prompt detail')).toBeInTheDocument();
  expect(screen.getByText('R-2')).toBeInTheDocument();
  expect(screen.getByText('Clarify the desired output')).toBeInTheDocument();
  expect(screen.getByText('Coaching context')).toBeInTheDocument();
});

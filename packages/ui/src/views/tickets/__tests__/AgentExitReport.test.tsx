import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import type { TicketAgentExit, TicketAgentExitCause } from '@claude-alive/core';
import { AgentExitReport } from '../AgentExitReport.tsx';
// Read from source rather than the package entry: @claude-alive/i18n exports no
// JSON subpath, and this test is about the bundles themselves, not the runtime.
import en from '../../../../../i18n/src/locales/en.json';
import ko from '../../../../../i18n/src/locales/ko.json';

const CAUSES: TicketAgentExitCause[] = [
  'terminated',
  'interrupted',
  'hangup',
  'killed',
  'spawn-failed',
  'exited',
  'no-result',
];

/** Resolve a dotted key against a locale bundle, or undefined when it is missing. */
function lookup(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, bundle);
}

function exitOf(over: Partial<TicketAgentExit> = {}): TicketAgentExit {
  return { cause: 'terminated', code: 143, signal: 'SIGTERM', signalInferred: true, resumable: true, ...over };
}

// Vitest globals are off here, so testing-library's auto-cleanup never runs:
// without this each render stacks on the last one's DOM.
afterEach(cleanup);

describe('AgentExitReport', () => {
  it('explains a SIGTERM instead of printing the number alone', () => {
    render(<AgentExitReport exit={exitOf({ ranMs: 465_872, round: 1 })} t={(k) => k} />);
    expect(screen.getByText('tickets.agentExit.cause.terminated')).toBeInTheDocument();
    expect(screen.getByText('tickets.agentExit.meaning.terminated')).toBeInTheDocument();
    expect(screen.getByText('tickets.agentExit.suspect.cancel')).toBeInTheDocument();
    expect(screen.getByText('143')).toBeInTheDocument();
    expect(screen.getByText('7m 45s')).toBeInTheDocument();
  });

  it('marks an inferred signal as inferred rather than reported', () => {
    render(<AgentExitReport exit={exitOf()} t={(k) => k} />);
    expect(screen.getByText('SIGTERM (tickets.agentExit.inferred)')).toBeInTheDocument();
  });

  it('states plainly when nothing can be resumed', () => {
    render(<AgentExitReport exit={exitOf({ cause: 'spawn-failed', resumable: false })} t={(k) => k} />);
    expect(screen.getByText('tickets.agentExit.resumableNo')).toBeInTheDocument();
    expect(screen.queryByText(/resumeHint/)).not.toBeInTheDocument();
  });

  it('shows the process error output when there is any', () => {
    render(<AgentExitReport exit={exitOf({ cause: 'exited', code: 1, stderr: 'spawn claude ENOENT' })} t={(k) => k} />);
    expect(screen.getByText('spawn claude ENOENT')).toBeInTheDocument();
  });

  it('has EN and KO copy for every cause it can render', () => {
    // A cause added without copy would otherwise ship as a raw key on screen.
    const used: string[] = [];
    for (const cause of CAUSES) {
      const { unmount } = render(<AgentExitReport exit={exitOf({ cause })} t={(k) => (used.push(k), k)} />);
      unmount();
    }
    const missing = [...new Set(used)].flatMap((key) => [
      ...(lookup(en, key) === undefined ? [`en:${key}`] : []),
      ...(lookup(ko, key) === undefined ? [`ko:${key}`] : []),
    ]);
    expect(missing).toEqual([]);
  });
});

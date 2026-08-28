import { describe, expect, it } from 'vitest';
import type { Run } from '@claude-alive/core';
import { runIdForSession } from '../runAttribution.js';

const run = (runId: string, kind: Run['kind'], sourceId: string): Run => ({
  runId, kind, sourceId, repoId: 'r1', worktreeId: 'w1',
  title: 't', state: 'running', startedAt: 1,
});

describe('runIdForSession', () => {
  it('prefers a run that owns the session directly', () => {
    const runs = [run('agent:s1', 'agent', 's1'), run('ticket:t1', 'ticket', 't1')];
    expect(runIdForSession(runs, 's1', () => 't1')).toBe('agent:s1');
  });

  it('falls back to the ticket the session was launched for', () => {
    const runs = [run('ticket:t1', 'ticket', 't1')];
    expect(runIdForSession(runs, 's9', (sid) => (sid === 's9' ? 't1' : undefined))).toBe('ticket:t1');
  });

  it('returns null when nothing claims the session', () => {
    expect(runIdForSession([run('ticket:t1', 'ticket', 't1')], 's9', () => undefined)).toBeNull();
  });

  it('returns null when the ticket lookup names a run that is not registered', () => {
    expect(runIdForSession([], 's9', () => 't-missing')).toBeNull();
  });

  it('matches a terminal run by its tab id used as the session', () => {
    const runs = [run('terminal:tab-3', 'terminal', 'tab-3')];
    expect(runIdForSession(runs, 'tab-3', () => undefined)).toBe('terminal:tab-3');
  });
});

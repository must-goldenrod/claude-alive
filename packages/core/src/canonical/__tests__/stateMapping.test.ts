import { describe, expect, test } from 'vitest';
import { normalizeLegacyState } from '../stateMapping.js';
import { AGENT_STATES } from '../../events/types.js';

describe('normalizeLegacyState', () => {
  test('maps every legacy AgentState to a common state, never unknown by omission', () => {
    for (const s of AGENT_STATES) {
      const n = normalizeLegacyState(s, null);
      expect(n.common).not.toBe('unknown');
      expect(n.providerState).toBe(s);
    }
  });

  test('active with a running tool is using-tool; without one it is thinking', () => {
    expect(normalizeLegacyState('active', 'Bash').common).toBe('using-tool');
    expect(normalizeLegacyState('active', null).common).toBe('thinking');
  });

  test('waiting means the user must act', () => {
    expect(normalizeLegacyState('waiting', null).common).toBe('waiting-user');
  });

  test('terminal states map to their canonical equivalents', () => {
    expect(normalizeLegacyState('done', null).common).toBe('completed');
    expect(normalizeLegacyState('error', null).common).toBe('failed');
    expect(normalizeLegacyState('despawning', null).common).toBe('stopped');
    expect(normalizeLegacyState('removed', null).common).toBe('stopped');
  });

  test('idle and listening are ready', () => {
    expect(normalizeLegacyState('idle', null).common).toBe('ready');
    expect(normalizeLegacyState('listening', null).common).toBe('ready');
  });

  test('spawning is starting', () => {
    expect(normalizeLegacyState('spawning', null).common).toBe('starting');
  });

  test('preserves the raw provider state and marks derivation confidence', () => {
    const n = normalizeLegacyState('active', 'Bash');
    expect(n.providerState).toBe('active');
    expect(n.confidence).toBe('derived');
  });

  test('an unrecognised state degrades to unknown rather than guessing', () => {
    const n = normalizeLegacyState('some-future-state', null);
    expect(n.common).toBe('unknown');
    expect(n.confidence).toBe('heuristic');
  });
});

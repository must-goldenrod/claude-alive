import { describe, it, expect } from 'vitest';
import { SessionStore } from '@claude-alive/core';
import { buildSpawnPlaceholderEvent } from '../spawnPlaceholder.js';

const UUID = '22222222-2222-4222-8222-222222222222';

describe('buildSpawnPlaceholderEvent', () => {
  it('returns null for the normal `claude` variant (real --session-id arrives)', () => {
    expect(
      buildSpawnPlaceholderEvent({ claudeVariant: 'claude', claudeSessionId: UUID, cwd: '/p' }),
    ).toBeNull();
  });

  it('returns null for shell mode (SSH presets / freeform)', () => {
    expect(
      buildSpawnPlaceholderEvent({ mode: 'shell', claudeVariant: 'agents', claudeSessionId: UUID }),
    ).toBeNull();
  });

  it('returns null when there is no session id to anchor on', () => {
    expect(buildSpawnPlaceholderEvent({ claudeVariant: 'agents', cwd: '/p' })).toBeNull();
  });

  it('builds a SessionStart for the `agents` variant with the minted id + cwd', () => {
    const ev = buildSpawnPlaceholderEvent({
      claudeVariant: 'agents',
      claudeSessionId: UUID,
      cwd: '/Users/me/proj',
    });
    expect(ev).not.toBeNull();
    expect(ev!.event).toBe('SessionStart');
    expect(ev!.session_id).toBe(UUID);
    expect(ev!.data.cwd).toBe('/Users/me/proj');
  });

  it('prefers resumeSessionId over claudeSessionId', () => {
    const resume = '33333333-3333-4333-8333-333333333333';
    const ev = buildSpawnPlaceholderEvent({
      claudeVariant: 'agents',
      claudeSessionId: UUID,
      resumeSessionId: resume,
      cwd: '/p',
    });
    expect(ev!.session_id).toBe(resume);
  });

  it('fed into SessionStore, the agent appears grouped by its cwd', () => {
    const store = new SessionStore();
    const ev = buildSpawnPlaceholderEvent({
      claudeVariant: 'agents',
      claudeSessionId: UUID,
      cwd: '/Users/me/proj',
    });
    store.processEvent(ev!);
    const agents = store.getAllAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]!.sessionId).toBe(UUID);
    expect(agents[0]!.cwd).toBe('/Users/me/proj');
    expect(agents[0]!.projectName).toBe('proj');
  });
});

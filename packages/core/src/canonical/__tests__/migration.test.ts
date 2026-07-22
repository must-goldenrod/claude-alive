import { describe, expect, test } from 'vitest';
import {
  migrateLegacyState,
  type LegacyAgent,
  type LegacyManagedSession,
  type LegacyOpenTab,
  type MigrationInput,
} from '../migration.js';

let n = 0;
function baseInput(over: Partial<MigrationInput> = {}): MigrationInput {
  n = 0;
  return {
    localLocationId: 'LOC_LOCAL',
    localLocationName: 'This Mac',
    now: 1_700_000_000_000,
    newId: () => `ID${++n}`,
    ...over,
  };
}

const agent = (o: Partial<LegacyAgent> = {}): LegacyAgent => ({
  sessionId: 'claude-1',
  cwd: '/repo/alpha',
  state: 'active',
  createdAt: 100,
  lastEventTime: 200,
  ...o,
});

const managed = (o: Partial<LegacyManagedSession> = {}): LegacyManagedSession => ({
  tabId: 'tab-a',
  claudeSessionId: 'claude-1',
  cwd: '/repo/alpha',
  mode: 'claude',
  claudeVariant: 'claude',
  createdAt: 100,
  lastActive: 200,
  ...o,
});

const tab = (o: Partial<LegacyOpenTab> = {}): LegacyOpenTab => ({
  tabId: 'tab-a',
  claudeSessionId: 'claude-1',
  cwd: '/repo/alpha',
  label: 'alpha',
  mode: 'claude',
  ...o,
});

describe('session identity — the P0 exit-gate invariant', () => {
  test('a session present in all three sources appears exactly once', () => {
    const result = migrateLegacyState(
      baseInput({ agents: [agent()], managedSessions: [managed()], openTabs: [tab()] }),
    );
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].providerSessionId).toBe('claude-1');
  });

  test('distinct claude sessions stay distinct', () => {
    const result = migrateLegacyState(
      baseInput({
        agents: [agent({ sessionId: 'claude-1' }), agent({ sessionId: 'claude-2' })],
        managedSessions: [managed({ claudeSessionId: 'claude-2', tabId: 'tab-b' })],
      }),
    );
    expect(result.sessions).toHaveLength(2);
    expect(new Set(result.sessions.map((s) => s.providerSessionId))).toEqual(new Set(['claude-1', 'claude-2']));
  });

  test('every session references a workspace and location that exist', () => {
    const result = migrateLegacyState(
      baseInput({ agents: [agent(), agent({ sessionId: 'claude-2', cwd: '/repo/beta' })] }),
    );
    const wsIds = new Set(result.workspaces.map((w) => w.workspaceId));
    const locIds = new Set(result.locations.map((l) => l.locationId));
    for (const s of result.sessions) {
      expect(wsIds.has(s.workspaceId)).toBe(true);
      expect(locIds.has(s.locationId)).toBe(true);
    }
  });
});

describe('subagents are agents, not sessions', () => {
  test('a subagent (parentId set) does not become an independent session', () => {
    const result = migrateLegacyState(
      baseInput({
        agents: [
          agent({ sessionId: 'claude-1' }),
          // SubagentStart stores the synthetic agent_id as sessionId and the real
          // parent Claude session in parentId.
          agent({ sessionId: 'sub-abc', parentId: 'claude-1' }),
        ],
      }),
    );
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].providerSessionId).toBe('claude-1');
    expect(result.skipped.some((s) => s.id === 'sub-abc')).toBe(true);
  });
});

describe('source precedence — live agent wins over stale records', () => {
  test('the live agent display name beats a stale managed record name', () => {
    // renameAgent updates only the live AgentInfo, so the managed record's name
    // goes stale; the migration must not resurrect it.
    const result = migrateLegacyState(
      baseInput({
        agents: [agent({ displayName: 'Live Name' })],
        managedSessions: [managed({ displayName: 'Old Managed Name' })],
      }),
    );
    expect(result.sessions[0].title).toBe('Live Name');
  });

  test('the live agent cwd beats a stale managed cwd', () => {
    const result = migrateLegacyState(
      baseInput({
        agents: [agent({ cwd: '/repo/current' })],
        managedSessions: [managed({ cwd: '/repo/stale' })],
      }),
    );
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0].rootPath).toBe('/repo/current');
  });
});

describe('workspaces', () => {
  test('paths differing only by trailing slash collapse into one workspace', () => {
    const result = migrateLegacyState(
      baseInput({
        agents: [agent({ sessionId: 'a', cwd: '/repo/alpha' }), agent({ sessionId: 'b', cwd: '/repo/alpha/' })],
      }),
    );
    expect(result.workspaces).toHaveLength(1);
  });

  test('duplicate slashes and surrounding whitespace are normalized', () => {
    const result = migrateLegacyState(
      baseInput({
        agents: [agent({ sessionId: 'a', cwd: '/repo/alpha' }), agent({ sessionId: 'b', cwd: '  /repo//alpha  ' })],
      }),
    );
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0].rootPath).toBe('/repo/alpha');
  });

  test('sessions sharing a cwd collapse into one workspace', () => {
    const result = migrateLegacyState(
      baseInput({ agents: [agent({ sessionId: 'a' }), agent({ sessionId: 'b' })] }),
    );
    expect(result.workspaces).toHaveLength(1);
    expect(result.sessions[0].workspaceId).toBe(result.sessions[1].workspaceId);
  });

  test('workspace display name falls back to the folder basename', () => {
    const result = migrateLegacyState(baseInput({ agents: [agent({ cwd: '/repo/alpha' })] }));
    expect(result.workspaces[0].displayName).toBe('alpha');
    expect(result.workspaces[0].kind).toBe('folder');
    expect(result.workspaces[0].rootPath).toBe('/repo/alpha');
  });

  test('different cwds produce different workspaces', () => {
    const result = migrateLegacyState(
      baseInput({ agents: [agent({ sessionId: 'a', cwd: '/repo/alpha' }), agent({ sessionId: 'b', cwd: '/repo/beta' })] }),
    );
    expect(result.workspaces).toHaveLength(2);
  });
});

describe('lifecycle and capabilities', () => {
  test('a live agent state maps to a live session', () => {
    const result = migrateLegacyState(baseInput({ agents: [agent({ state: 'active' })] }));
    expect(result.sessions[0].lifecycle).toBe('live');
  });

  test('a done agent maps to completed', () => {
    const result = migrateLegacyState(baseInput({ agents: [agent({ state: 'done' })] }));
    expect(result.sessions[0].lifecycle).toBe('completed');
  });

  test('an errored agent maps to failed', () => {
    const result = migrateLegacyState(baseInput({ agents: [agent({ state: 'error' })] }));
    expect(result.sessions[0].lifecycle).toBe('failed');
  });

  test('a managed session with no live agent is dormant but resumable', () => {
    const result = migrateLegacyState(baseInput({ managedSessions: [managed()] }));
    expect(result.sessions[0].lifecycle).toBe('dormant');
    expect(result.sessions[0].resumeCapability).toBe('available');
    expect(result.sessions[0].historyCapability).toBe('transcript');
  });

  test('an external agent we never spawned is marked external', () => {
    const result = migrateLegacyState(baseInput({ agents: [agent({ state: 'idle', source: 'external' })] }));
    expect(result.sessions[0].lifecycle).toBe('external');
  });
});

describe('titles', () => {
  test('a user-set display name becomes a manual title', () => {
    const result = migrateLegacyState(baseInput({ agents: [agent({ displayName: 'Auth refactor' })] }));
    expect(result.sessions[0].title).toBe('Auth refactor');
    expect(result.sessions[0].titleSource).toBe('manual');
  });

  test('otherwise the first prompt generates the title', () => {
    const result = migrateLegacyState(
      baseInput({ agents: [agent({ lastPrompt: 'refactor the auth module' })] }),
    );
    expect(result.sessions[0].titleSource).toBe('first-prompt');
    expect(result.sessions[0].title).toBe('refactor t…');
    expect(result.sessions[0].firstPromptPreview).toBe('refactor the auth module');
  });

  test('with neither, it falls back', () => {
    const result = migrateLegacyState(baseInput({ agents: [agent()] }));
    expect(result.sessions[0].titleSource).toBe('fallback');
  });
});

describe('entries that cannot become sessions are reported, never silently dropped', () => {
  test('a shell-mode tab is not a session and is recorded as skipped', () => {
    const result = migrateLegacyState(baseInput({ openTabs: [tab({ mode: 'shell', claudeSessionId: undefined })] }));
    expect(result.sessions).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/terminal-only|no agent session/i);
  });

  test('an entry with no cwd cannot be placed in a workspace and is recorded', () => {
    const result = migrateLegacyState(baseInput({ managedSessions: [managed({ cwd: undefined })] }));
    expect(result.sessions).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/cwd/i);
    expect(result.skipped[0].id).toBe('claude-1');
    expect(result.skipped[0].source).toBe('managed-session');
  });

  test('a cwd-less candidate known only from a tab is labelled open-tab, not managed-session', () => {
    const result = migrateLegacyState(
      baseInput({ openTabs: [tab({ cwd: undefined, claudeSessionId: 'claude-9' })] }),
    );
    expect(result.sessions).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ source: 'open-tab', id: 'claude-9' });
  });
});

describe('historyCapability is evidence-based, not assumed', () => {
  test('an agent with a transcript path reports transcript history', () => {
    const result = migrateLegacyState(
      baseInput({ agents: [agent({ transcriptPath: '/home/u/.claude/x.jsonl' })] }),
    );
    expect(result.sessions[0].historyCapability).toBe('transcript');
  });

  test('a UI-spawned managed session reports transcript history', () => {
    const result = migrateLegacyState(baseInput({ managedSessions: [managed()] }));
    expect(result.sessions[0].historyCapability).toBe('transcript');
  });

  test('a session known only from a tab claims no structured history', () => {
    const result = migrateLegacyState(baseInput({ openTabs: [tab({ claudeSessionId: 'claude-7' })] }));
    expect(result.sessions[0].historyCapability).toBe('scrollback-only');
  });
});

describe('locations', () => {
  test('the local location is emitted and used by migrated sessions', () => {
    const result = migrateLegacyState(baseInput({ agents: [agent()] }));
    expect(result.locations).toHaveLength(1);
    expect(result.locations[0]).toMatchObject({ locationId: 'LOC_LOCAL', kind: 'local', displayName: 'This Mac' });
    expect(result.sessions[0].locationId).toBe('LOC_LOCAL');
  });
});

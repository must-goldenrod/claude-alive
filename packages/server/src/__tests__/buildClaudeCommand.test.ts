import { describe, it, expect } from 'vitest';
import { buildClaudeCommand } from '../claudeTerminal.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('buildClaudeCommand', () => {
  describe("variant 'claude' (root CLI)", () => {
    it('bare command when no options', () => {
      expect(buildClaudeCommand({})).toBe('claude');
    });

    it('passes --session-id for a valid UUID', () => {
      expect(buildClaudeCommand({ claudeSessionId: UUID })).toBe(
        `claude --session-id ${UUID}`,
      );
    });

    it('--resume wins over --session-id', () => {
      expect(
        buildClaudeCommand({ claudeSessionId: UUID, resumeSessionId: UUID }),
      ).toBe(`claude --resume ${UUID}`);
    });

    it('adds -n display name and skip-permissions', () => {
      expect(
        buildClaudeCommand({ displayName: 'My App', skipPermissions: true }),
      ).toBe("claude -n 'My App' --dangerously-skip-permissions");
    });

    it('ignores a non-UUID session id', () => {
      expect(buildClaudeCommand({ claudeSessionId: 'not-a-uuid' })).toBe('claude');
    });
  });

  describe("variant 'agents' (background agent manager)", () => {
    it('bare `claude agents` when no options', () => {
      expect(buildClaudeCommand({ claudeVariant: 'agents' })).toBe('claude agents');
    });

    it('does NOT pass --session-id (unsupported by `claude agents`)', () => {
      const cmd = buildClaudeCommand({ claudeVariant: 'agents', claudeSessionId: UUID });
      expect(cmd).toBe('claude agents');
      expect(cmd).not.toContain('--session-id');
    });

    it('does NOT pass --resume or -n (unsupported by `claude agents`)', () => {
      const cmd = buildClaudeCommand({
        claudeVariant: 'agents',
        resumeSessionId: UUID,
        displayName: 'My App',
      });
      expect(cmd).toBe('claude agents');
      expect(cmd).not.toContain('--resume');
      expect(cmd).not.toContain('-n');
    });

    it('still forwards --dangerously-skip-permissions (shared flag)', () => {
      expect(
        buildClaudeCommand({ claudeVariant: 'agents', skipPermissions: true }),
      ).toBe('claude agents --dangerously-skip-permissions');
    });
  });
});

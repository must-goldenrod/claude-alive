import { describe, it, expect } from 'vitest';
import { transition } from '../state/agentFSM.js';
import type { AgentState, HookEventName } from '../events/types.js';

describe('agentFSM', () => {
  describe('transition()', () => {
    // --- spawning state ---
    it('spawning → listening on UserPromptSubmit', () => {
      const r = transition('spawning', 'UserPromptSubmit');
      expect(r.newState).toBe('listening');
    });

    it('spawning → active on PreToolUse', () => {
      const r = transition('spawning', 'PreToolUse', 'Write');
      expect(r.newState).toBe('active');
      expect(r.toolAnimation).toBe('typing');
      expect(r.toolName).toBe('Write');
    });

    it('spawning → idle on Stop', () => {
      expect(transition('spawning', 'Stop').newState).toBe('idle');
    });

    it('spawning → despawning on SessionEnd', () => {
      expect(transition('spawning', 'SessionEnd').newState).toBe('despawning');
    });

    it('spawning stays spawning on unrecognized event', () => {
      expect(transition('spawning', 'Notification').newState).toBe('spawning');
    });

    // --- idle state ---
    it('idle → listening on UserPromptSubmit', () => {
      expect(transition('idle', 'UserPromptSubmit').newState).toBe('listening');
    });

    it('idle → active on PreToolUse', () => {
      expect(transition('idle', 'PreToolUse', 'Bash').newState).toBe('active');
    });

    it('idle → done on TaskCompleted', () => {
      expect(transition('idle', 'TaskCompleted').newState).toBe('done');
    });

    it('idle stays idle on Notification', () => {
      expect(transition('idle', 'Notification').newState).toBe('idle');
    });

    // --- listening state ---
    it('listening → active on PreToolUse', () => {
      expect(transition('listening', 'PreToolUse', 'Read').newState).toBe('active');
    });

    it('listening → idle on Stop', () => {
      expect(transition('listening', 'Stop').newState).toBe('idle');
    });

    it('listening → done on TaskCompleted', () => {
      expect(transition('listening', 'TaskCompleted').newState).toBe('done');
    });

    // --- active state ---
    it('active stays active on PostToolUse', () => {
      expect(transition('active', 'PostToolUse').newState).toBe('active');
    });

    it('active → error on PostToolUseFailure', () => {
      expect(transition('active', 'PostToolUseFailure').newState).toBe('error');
    });

    it('active → waiting on PermissionRequest', () => {
      expect(transition('active', 'PermissionRequest').newState).toBe('waiting');
    });

    it('active stays active on SubagentStart', () => {
      expect(transition('active', 'SubagentStart').newState).toBe('active');
    });

    it('active stays active on SubagentStop', () => {
      expect(transition('active', 'SubagentStop').newState).toBe('active');
    });

    it('active → idle on Stop', () => {
      expect(transition('active', 'Stop').newState).toBe('idle');
    });

    it('active → done on TaskCompleted', () => {
      expect(transition('active', 'TaskCompleted').newState).toBe('done');
    });

    // --- waiting state ---
    it('waiting → active on PreToolUse', () => {
      expect(transition('waiting', 'PreToolUse', 'Glob').newState).toBe('active');
    });

    it('waiting stays waiting on Notification', () => {
      expect(transition('waiting', 'Notification').newState).toBe('waiting');
    });

    // --- error state ---
    it('error → active on PreToolUse', () => {
      expect(transition('error', 'PreToolUse', 'Edit').newState).toBe('active');
    });

    it('error → listening on UserPromptSubmit', () => {
      expect(transition('error', 'UserPromptSubmit').newState).toBe('listening');
    });

    it('error → idle on Stop', () => {
      expect(transition('error', 'Stop').newState).toBe('idle');
    });

    // --- done state ---
    it('done → listening on UserPromptSubmit', () => {
      expect(transition('done', 'UserPromptSubmit').newState).toBe('listening');
    });

    it('done → active on PreToolUse', () => {
      expect(transition('done', 'PreToolUse', 'Bash').newState).toBe('active');
    });

    it('done → despawning on SessionEnd', () => {
      expect(transition('done', 'SessionEnd').newState).toBe('despawning');
    });

    // --- despawning / removed are terminal ---
    it('despawning ignores all events', () => {
      expect(transition('despawning', 'PreToolUse').newState).toBe('despawning');
      expect(transition('despawning', 'SessionEnd').newState).toBe('despawning');
    });

    it('removed ignores all events', () => {
      expect(transition('removed', 'PreToolUse').newState).toBe('removed');
    });

    // --- tool animation ---
    it('returns null animation when not active', () => {
      const r = transition('spawning', 'UserPromptSubmit');
      expect(r.toolAnimation).toBeNull();
    });

    it('returns correct animation for Write tool', () => {
      const r = transition('idle', 'PreToolUse', 'Write');
      expect(r.toolAnimation).toBe('typing');
    });

    it('returns correct animation for Read tool', () => {
      const r = transition('idle', 'PreToolUse', 'Read');
      expect(r.toolAnimation).toBe('reading');
    });

    it('returns correct animation for Bash tool', () => {
      const r = transition('idle', 'PreToolUse', 'Bash');
      expect(r.toolAnimation).toBe('running');
    });

    it('returns correct animation for WebSearch tool', () => {
      const r = transition('idle', 'PreToolUse', 'WebSearch');
      expect(r.toolAnimation).toBe('searching');
    });

    it('returns null toolName when no tool provided', () => {
      const r = transition('idle', 'UserPromptSubmit');
      expect(r.toolName).toBeNull();
    });
  });
});

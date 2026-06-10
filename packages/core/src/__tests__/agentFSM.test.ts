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

    it('spawning stays spawning on Notification (no decision routing at FSM level)', () => {
      // Raw Notification no longer forces waiting — decision-request
      // classification happens in SessionStore, which remaps to
      // PermissionRequest only for genuine blocked-on-user messages.
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

    it('idle stays idle on Notification (idle-60s prompt is not a decision)', () => {
      expect(transition('idle', 'Notification').newState).toBe('idle');
    });

    it('idle → waiting on PreToolUse(AskUserQuestion)', () => {
      expect(transition('idle', 'PreToolUse', 'AskUserQuestion').newState).toBe('waiting');
    });

    it('active → waiting on PreToolUse(AskUserQuestion)', () => {
      expect(transition('active', 'PreToolUse', 'AskUserQuestion').newState).toBe('waiting');
    });

    it('active stays active on Notification (no decision routing at FSM level)', () => {
      expect(transition('active', 'Notification').newState).toBe('active');
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

    it('listening → waiting on PermissionRequest', () => {
      expect(transition('listening', 'PermissionRequest').newState).toBe('waiting');
    });

    it('idle → waiting on PermissionRequest', () => {
      expect(transition('idle', 'PermissionRequest').newState).toBe('waiting');
    });

    it('done → waiting on PermissionRequest', () => {
      expect(transition('done', 'PermissionRequest').newState).toBe('waiting');
    });

    it('error → waiting on PermissionRequest', () => {
      expect(transition('error', 'PermissionRequest').newState).toBe('waiting');
    });

    it('waiting → listening on UserPromptSubmit (user resumes after deny)', () => {
      expect(transition('waiting', 'UserPromptSubmit').newState).toBe('listening');
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

    // --- waiting state (sticky question marker) ---
    // PreToolUse and PostToolUse no longer exit waiting — by design the
    // amber question state persists until the user explicitly prompts
    // again. See agentFSM.ts comment for the rationale.
    it('waiting stays waiting on PreToolUse', () => {
      expect(transition('waiting', 'PreToolUse', 'Glob').newState).toBe('waiting');
    });

    it('waiting stays waiting on PostToolUse', () => {
      expect(transition('waiting', 'PostToolUse').newState).toBe('waiting');
    });

    it('waiting stays waiting on Notification', () => {
      expect(transition('waiting', 'Notification').newState).toBe('waiting');
    });

    it('waiting → listening only on UserPromptSubmit', () => {
      expect(transition('waiting', 'UserPromptSubmit').newState).toBe('listening');
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

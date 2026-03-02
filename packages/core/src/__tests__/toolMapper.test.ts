import { describe, it, expect } from 'vitest';
import { toolToAnimation, extractToolDisplayName } from '../events/toolMapper.js';

describe('toolMapper', () => {
  describe('toolToAnimation()', () => {
    it('maps Write to typing', () => {
      expect(toolToAnimation('Write')).toBe('typing');
    });

    it('maps Edit to typing', () => {
      expect(toolToAnimation('Edit')).toBe('typing');
    });

    it('maps Task to typing', () => {
      expect(toolToAnimation('Task')).toBe('typing');
    });

    it('maps NotebookEdit to typing', () => {
      expect(toolToAnimation('NotebookEdit')).toBe('typing');
    });

    it('maps Bash to running', () => {
      expect(toolToAnimation('Bash')).toBe('running');
    });

    it('maps Read to reading', () => {
      expect(toolToAnimation('Read')).toBe('reading');
    });

    it('maps Grep to reading', () => {
      expect(toolToAnimation('Grep')).toBe('reading');
    });

    it('maps Glob to reading', () => {
      expect(toolToAnimation('Glob')).toBe('reading');
    });

    it('maps WebFetch to searching', () => {
      expect(toolToAnimation('WebFetch')).toBe('searching');
    });

    it('maps WebSearch to searching', () => {
      expect(toolToAnimation('WebSearch')).toBe('searching');
    });

    it('maps EnterPlanMode to thinking', () => {
      expect(toolToAnimation('EnterPlanMode')).toBe('thinking');
    });

    it('maps ExitPlanMode to thinking', () => {
      expect(toolToAnimation('ExitPlanMode')).toBe('thinking');
    });

    it('maps AskUserQuestion to thinking', () => {
      expect(toolToAnimation('AskUserQuestion')).toBe('thinking');
    });

    it('maps TaskCreate to thinking', () => {
      expect(toolToAnimation('TaskCreate')).toBe('thinking');
    });

    it('maps mcp__ prefixed tools to running', () => {
      expect(toolToAnimation('mcp__github__createPR')).toBe('running');
    });

    it('maps unknown tools to running', () => {
      expect(toolToAnimation('SomeUnknownTool')).toBe('running');
    });
  });

  describe('extractToolDisplayName()', () => {
    it('returns tool name as-is for non-MCP tools', () => {
      expect(extractToolDisplayName('Write')).toBe('Write');
      expect(extractToolDisplayName('Bash')).toBe('Bash');
    });

    it('extracts last segment from MCP tool name', () => {
      expect(extractToolDisplayName('mcp__github__createPR')).toBe('createPR');
    });

    it('handles single-segment MCP tool', () => {
      expect(extractToolDisplayName('mcp__tool')).toBe('tool');
    });

    it('handles deep MCP tool paths', () => {
      expect(extractToolDisplayName('mcp__server__namespace__method')).toBe('method');
    });
  });
});

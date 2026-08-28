import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '@claude-alive/i18n';
import { buildAlertContent, folderLabel, normalizePrompt } from '../services/notificationContent.ts';

describe('notificationContent', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  describe('folderLabel', () => {
    it('keeps only the last folder of the path', () => {
      expect(folderLabel('/Users/jane/work')).toBe('work');
      expect(folderLabel('/Users/jane/a/b/c/d/claude-alive')).toBe('claude-alive');
      expect(folderLabel('/srv/app/')).toBe('app');
    });

    it('returns an empty string for a rootless path', () => {
      expect(folderLabel('/')).toBe('');
      expect(folderLabel('   ')).toBe('');
    });
  });

  describe('normalizePrompt', () => {
    it('keeps the whole prompt, including later lines', () => {
      expect(normalizePrompt('\n\n  fix the toast  \nand more\n')).toBe('fix the toast\nand more');
    });

    it('does not clip long prompts', () => {
      const long = 'x'.repeat(500);
      expect(normalizePrompt(long)).toBe(long);
    });
  });

  describe('buildAlertContent', () => {
    it('leads with the project name and the stage, never a session id', () => {
      const content = buildAlertContent('waiting', {
        projectName: 'claude-alive',
        cwd: '/Users/jane/Documents/claude-alive',
        tool: 'Bash',
        lastPrompt: 'move the toast to the bottom left',
      });
      expect(content.title).toBe('claude-alive · Needs permission');
      expect(content.body).toContain('Folder: claude-alive');
      expect(content.body).toContain('Input: "move the toast to the bottom left"');
      expect(content.body).toContain('Tool: Bash');
    });

    it('carries the full multi-line prompt into the body', () => {
      const prompt = 'line one\nline two\nline three';
      const content = buildAlertContent('waiting', { cwd: '/srv/api', lastPrompt: prompt });
      expect(content.body).toContain(`Input: "${prompt}"`);
    });

    it('falls back to the cwd basename when no project name is known', () => {
      const content = buildAlertContent('done', { cwd: '/srv/checkout-api' });
      expect(content.title).toBe('checkout-api · Task completed');
    });

    it('omits lines with no data instead of printing empty labels', () => {
      const content = buildAlertContent('error', { cwd: '/srv/api', tool: null, lastPrompt: '' });
      expect(content.lines).toEqual(['Folder: api']);
    });

    it('adds the agent name only when it differs from the project label', () => {
      const same = buildAlertContent('done', { cwd: '/srv/api', projectName: 'api', displayName: 'api' });
      expect(same.lines.some((l) => l.startsWith('Agent:'))).toBe(false);

      const differs = buildAlertContent('done', { cwd: '/srv/api', projectName: 'api', displayName: 'reviewer' });
      expect(differs.lines).toContain('Agent: reviewer');
    });

    it('still identifies the work when the agent has no cwd', () => {
      const content = buildAlertContent('waiting', { displayName: 'reviewer' });
      expect(content.title).toBe('reviewer · Needs permission');
    });

    it('translates the stage and labels', async () => {
      await i18n.changeLanguage('ko');
      const content = buildAlertContent('waiting', { cwd: '/srv/api', tool: 'Bash' });
      expect(content.title).toBe('api · 권한 필요');
      expect(content.lines).toContain('도구: Bash');
      await i18n.changeLanguage('en');
    });
  });
});

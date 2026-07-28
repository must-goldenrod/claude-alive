import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '@claude-alive/i18n';
import { buildAlertContent, shortenPath, summarizePrompt } from '../services/notificationContent.ts';

describe('notificationContent', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  describe('shortenPath', () => {
    it('collapses the home prefix to ~', () => {
      expect(shortenPath('/Users/jane/work')).toBe('~/work');
      expect(shortenPath('/home/jane/work')).toBe('~/work');
    });

    it('keeps only the trailing segments of a deep path', () => {
      expect(shortenPath('/Users/jane/a/b/c/d/claude-alive')).toBe('…/c/d/claude-alive');
    });

    it('leaves a short path untouched', () => {
      expect(shortenPath('/srv/app')).toBe('/srv/app');
    });
  });

  describe('summarizePrompt', () => {
    it('takes the first non-empty line', () => {
      expect(summarizePrompt('\n\n  fix the toast  \nand more')).toBe('fix the toast');
    });

    it('clips long prompts', () => {
      const long = 'x'.repeat(200);
      const out = summarizePrompt(long);
      expect(out.length).toBe(81);
      expect(out.endsWith('…')).toBe(true);
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
      expect(content.body).toContain('Folder: ~/Documents/claude-alive');
      expect(content.body).toContain('Input: "move the toast to the bottom left"');
      expect(content.body).toContain('Tool: Bash');
    });

    it('falls back to the cwd basename when no project name is known', () => {
      const content = buildAlertContent('done', { cwd: '/srv/checkout-api' });
      expect(content.title).toBe('checkout-api · Task completed');
    });

    it('omits lines with no data instead of printing empty labels', () => {
      const content = buildAlertContent('error', { cwd: '/srv/api', tool: null, lastPrompt: '' });
      expect(content.lines).toEqual(['Folder: /srv/api']);
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

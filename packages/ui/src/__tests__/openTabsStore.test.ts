import { describe, it, expect } from 'vitest';
import { isRestorableTab } from '../views/chat/openTabsStore.ts';

const tab = { exited: false, source: 'local', mode: 'claude' as const, claudeSessionId: 'sid' };

describe('isRestorableTab', () => {
  it('keeps live Claude tabs', () => {
    expect(isRestorableTab(tab)).toBe(true);
  });

  it('keeps a tab whose pty was killed (reboot), drops one the user exited', () => {
    expect(isRestorableTab({ ...tab, exited: true, interrupted: true })).toBe(true);
    expect(isRestorableTab({ ...tab, exited: true })).toBe(false);
  });

  it('never keeps ssh, shell, or id-less tabs', () => {
    expect(isRestorableTab({ ...tab, source: 'ssh' })).toBe(false);
    expect(isRestorableTab({ ...tab, mode: 'shell' })).toBe(false);
    expect(isRestorableTab({ ...tab, claudeSessionId: undefined })).toBe(false);
  });
});

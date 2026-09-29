import { describe, it, expect } from 'vitest';
import { resumeTarget } from '../mobileResume.ts';
import type { MobileSession } from '../MobileSessionList.tsx';

const base: MobileSession = {
  sessionId: 's1', displayName: '', state: 'exited', cwd: '/proj', lastActivityAt: 0, needsApproval: false,
};
const mint = () => 'tab-new';

describe('resumeTarget', () => {
  it('resumes into the existing tab with the dormant id first', () => {
    const t = resumeTarget({ ...base, providerSessionId: 'catalog', origin: 'desktop' }, 'tab-a', 'dormant', mint);
    expect(t).toEqual({ tabId: 'tab-a', claudeSessionId: 'dormant', cwd: '/proj', origin: 'desktop' });
  });

  it('falls back to the catalog id and mints a phone-owned tab when none is attached', () => {
    const t = resumeTarget({ ...base, providerSessionId: 'catalog' }, null, null, mint);
    expect(t).toEqual({ tabId: 'tab-new', claudeSessionId: 'catalog', cwd: '/proj', origin: 'mobile' });
  });

  it('offers nothing for a plain shell or a row without a cwd', () => {
    expect(resumeTarget(base, 'tab-a', null, mint)).toBeNull();
    expect(resumeTarget({ ...base, cwd: '', providerSessionId: 'x' }, null, null, mint)).toBeNull();
  });
});

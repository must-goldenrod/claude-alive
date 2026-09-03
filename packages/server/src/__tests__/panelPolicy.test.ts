import { describe, it, expect } from 'vitest';
import { parsePanelExcludedRoots, isUnderRoot, panelAllowedFor } from '../panel/panelPolicy.js';

describe('parsePanelExcludedRoots', () => {
  it('is empty when unset', () => {
    expect(parsePanelExcludedRoots({})).toEqual([]);
  });
  it('splits, trims and normalizes a colon-separated list', () => {
    expect(parsePanelExcludedRoots({ CLAUDE_ALIVE_PANEL_EXCLUDE: '/secret/: /work/a ::' })).toEqual(['/secret', '/work/a']);
  });
});

describe('isUnderRoot', () => {
  it('matches the root itself and anything inside it', () => {
    expect(isUnderRoot('/secret', ['/secret'])).toBe(true);
    expect(isUnderRoot('/secret/repo/src', ['/secret'])).toBe(true);
  });
  it('does not match a sibling that merely shares a prefix', () => {
    expect(isUnderRoot('/secretive', ['/secret'])).toBe(false);
  });
  it('is false with no roots', () => {
    expect(isUnderRoot('/anywhere', [])).toBe(false);
  });
});

describe('panelAllowedFor', () => {
  it('allows a ticket by default', () => {
    expect(panelAllowedFor({ cwd: '/work/repo' }, [])).toBe(true);
  });
  it('honours the ticket opt-out', () => {
    expect(panelAllowedFor({ cwd: '/work/repo', panelReview: false }, [])).toBe(false);
  });
  it('honours an operator-excluded tree', () => {
    expect(panelAllowedFor({ cwd: '/secret/repo' }, ['/secret'])).toBe(false);
  });
  it('does not let a ticket opt back into an excluded tree', () => {
    expect(panelAllowedFor({ cwd: '/secret/repo', panelReview: true }, ['/secret'])).toBe(false);
  });
});

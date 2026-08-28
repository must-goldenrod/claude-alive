import { describe, expect, it } from 'vitest';
import {
  PROJECT_SIDEBAR_WIDTH,
  REPO_SIDEBAR_WIDTH,
  layoutInsets,
} from '../state/layoutInsets.ts';

describe('layoutInsets', () => {
  it('reserves the repo sidebar width while the left panel is open', () => {
    expect(layoutInsets(true).repo).toBe(REPO_SIDEBAR_WIDTH);
  });

  it('reserves nothing once the left panel is collapsed', () => {
    expect(layoutInsets(false)).toEqual({ repo: 0, list: 0 });
  });

  it('stacks both sidebars for the list layout', () => {
    expect(layoutInsets(true).list).toBe(REPO_SIDEBAR_WIDTH + PROJECT_SIDEBAR_WIDTH);
  });

  it('never lets the list inset fall behind the repo inset', () => {
    for (const open of [true, false]) {
      const insets = layoutInsets(open);
      expect(insets.list).toBeGreaterThanOrEqual(insets.repo);
    }
  });
});

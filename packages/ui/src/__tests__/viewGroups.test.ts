import { describe, it, expect } from 'vitest';
import { VIEW_MODE_META, viewsInGroup, groupOf } from '../components/viewGroups.ts';

describe('viewGroups', () => {
  it('places tickets alone in the primary group', () => {
    const primary = viewsInGroup('primary');
    expect(primary.map((m) => m.mode)).toEqual(['tickets']);
  });

  it('groups observation/hands-on views under intervene, in order', () => {
    expect(viewsInGroup('intervene').map((m) => m.mode)).toEqual([
      'animation',
      'list',
      'spread',
    ]);
  });

  it('groups productivity views under tools, in order', () => {
    expect(viewsInGroup('tools').map((m) => m.mode)).toEqual([
      'workspace',
      'data',
      'prompt',
      'efficio',
      'archive',
      'ticketMgmt',
      'backends',
    ]);
  });

  it('assigns every surfaced view to exactly one group (no gaps, no dupes)', () => {
    const modes = VIEW_MODE_META.map((m) => m.mode);
    expect(new Set(modes).size).toBe(modes.length); // no duplicates
    for (const m of VIEW_MODE_META) {
      expect(groupOf(m.mode)).toBe(m.group);
    }
  });

  it('does not surface jarvis in the header', () => {
    expect(groupOf('jarvis')).toBeUndefined();
  });

  it('gives every entry a viewMode.* label key', () => {
    for (const m of VIEW_MODE_META) {
      expect(m.labelKey).toMatch(/^viewMode\./);
    }
  });
});

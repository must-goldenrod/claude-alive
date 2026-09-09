import { describe, it, expect } from 'vitest';
import type { Ticket } from '@claude-alive/core';
import { mergeProjects } from '../mobileProjects.ts';

const ticket = (cwd: string, at: number): Ticket =>
  ({ id: cwd, seq: 1, goal: 'g', cwd, state: 'done', createdAt: at } as Ticket);

describe('mergeProjects', () => {
  it('uses the server allowlist when it has one', () => {
    const allowed = [{ path: '/w/app', name: 'app' }];
    expect(mergeProjects(allowed, [ticket('/other/thing', 1)])).toEqual(allowed);
  });

  it('falls back to the projects tickets actually ran in — a local-only server sends no allowlist', () => {
    const out = mergeProjects([], [ticket('/w/app', 1), ticket('/w/site', 2)]);
    expect(out.map((p) => p.name)).toEqual(['site', 'app']);
  });

  it('lists each project once, most recent first', () => {
    const out = mergeProjects([], [ticket('/w/app', 1), ticket('/w/app', 5), ticket('/w/site', 3)]);
    expect(out.map((p) => p.path)).toEqual(['/w/app', '/w/site']);
  });

  it('returns nothing when there is nothing to offer', () => {
    expect(mergeProjects([], [])).toEqual([]);
  });
});

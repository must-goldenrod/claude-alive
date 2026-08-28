import { describe, expect, it } from 'vitest';
import { editedPathFrom, mergeTouchedFiles } from '../runs/touchedFiles.js';

describe('editedPathFrom', () => {
  it('reads the path a write-style tool targeted', () => {
    for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
      expect(editedPathFrom(tool, { file_path: '/r/proj/a.ts' })).toBe('/r/proj/a.ts');
    }
  });

  it('accepts notebook_path, which NotebookEdit uses instead', () => {
    expect(editedPathFrom('NotebookEdit', { notebook_path: '/r/n.ipynb' })).toBe('/r/n.ipynb');
  });

  it('ignores read-only tools even when they name a path', () => {
    for (const tool of ['Read', 'Grep', 'Glob', 'Bash']) {
      expect(editedPathFrom(tool, { file_path: '/r/proj/a.ts' })).toBeNull();
    }
  });

  it('ignores a write tool with no usable path', () => {
    expect(editedPathFrom('Edit', {})).toBeNull();
    expect(editedPathFrom('Edit', { file_path: 42 })).toBeNull();
    expect(editedPathFrom('Edit', undefined)).toBeNull();
  });

  it('is case-insensitive about the tool name', () => {
    expect(editedPathFrom('edit', { file_path: '/a' })).toBe('/a');
  });
});

describe('mergeTouchedFiles', () => {
  it('appends a new path', () => {
    expect(mergeTouchedFiles(['/a'], '/b')).toEqual(['/a', '/b']);
  });

  it('does not duplicate a path already recorded', () => {
    expect(mergeTouchedFiles(['/a', '/b'], '/a')).toEqual(['/a', '/b']);
  });

  it('starts a list when there was none', () => {
    expect(mergeTouchedFiles(undefined, '/a')).toEqual(['/a']);
  });

  it('keeps first-touched order and caps the list', () => {
    const many = Array.from({ length: 200 }, (_, i) => `/f${i}`);
    const out = mergeTouchedFiles(many, '/new');
    expect(out).toHaveLength(200);
    expect(out[0]).toBe('/f0');
    expect(out).not.toContain('/new');
  });
});

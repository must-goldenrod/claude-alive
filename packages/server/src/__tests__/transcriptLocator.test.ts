import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findTranscriptFile, readTranscriptConversation } from '../transcriptLocator.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'alive-transcripts-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeTranscript(project: string, sessionId: string, lines: unknown[]): void {
  const dir = join(root, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'));
}

describe('findTranscriptFile', () => {
  test('finds a transcript by session id under any project directory', () => {
    writeTranscript('-Users-x-repo-a', 'sess-1', [{ type: 'user', message: { content: 'hi' } }]);
    const path = findTranscriptFile('sess-1', root);
    expect(path).toContain('sess-1.jsonl');
  });

  test('returns null when no transcript exists for the session', () => {
    expect(findTranscriptFile('missing', root)).toBeNull();
  });

  test('returns null when the projects root does not exist', () => {
    expect(findTranscriptFile('sess-1', join(root, 'nope'))).toBeNull();
  });
});

describe('readTranscriptConversation', () => {
  test('reads and parses a transcript into conversation items', () => {
    writeTranscript('-Users-x-repo-a', 'sess-2', [
      { type: 'user', message: { content: 'run the tests' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'all green' }] } },
    ]);
    const result = readTranscriptConversation('sess-2', root);
    expect(result).not.toBeNull();
    expect(result!.items.map((i) => i.kind)).toEqual(['user', 'assistant']);
  });

  test('returns null when there is no transcript, so the caller can fall back', () => {
    expect(readTranscriptConversation('none', root)).toBeNull();
  });

  test('an unreadable transcript yields null rather than throwing', () => {
    // A directory named like a transcript cannot be read as a file.
    mkdirSync(join(root, 'proj', 'sess-3.jsonl'), { recursive: true });
    expect(readTranscriptConversation('sess-3', root)).toBeNull();
  });
});

describe('readTranscriptConversation with a hook-reported path', () => {
  test('prefers the path the hook reported over the projects-root scan', () => {
    const custom = mkdtempSync(join(tmpdir(), 'alive-custom-config-'));
    try {
      const path = join(custom, 'sess-9.jsonl');
      writeFileSync(path, JSON.stringify({ type: 'user', message: { content: 'from custom dir' } }));
      const result = readTranscriptConversation('sess-9', root, path);
      expect(result?.transcriptPath).toBe(path);
    } finally {
      rmSync(custom, { recursive: true, force: true });
    }
  });

  test('falls back to the scan when the reported path no longer exists', () => {
    writeTranscript('-Users-x-repo-a', 'sess-10', [{ type: 'user', message: { content: 'hi' } }]);
    const result = readTranscriptConversation('sess-10', root, join(root, 'gone.jsonl'));
    expect(result?.transcriptPath).toContain('sess-10.jsonl');
  });
});

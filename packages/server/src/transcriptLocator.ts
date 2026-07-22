/**
 * Locates and reads a Claude session transcript (spec §F.7 "1순위").
 *
 * Claude stores each session at
 * `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. We do not know the
 * encoded-cwd for an imported session, so the file is found by session id across
 * the project directories. This is the authoritative full conversation; the
 * hook-derived events are only a fallback for sessions with no transcript.
 *
 * All failures degrade to `null` — a session whose transcript we cannot read must
 * fall back to hook data, never crash the conversation endpoint.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseTranscriptToConversation, type ConversationItem } from '@claude-alive/core';

export function defaultProjectsRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

/** Find `<sessionId>.jsonl` under any project directory, or null. */
export function findTranscriptFile(sessionId: string, projectsRoot = defaultProjectsRoot()): string | null {
  const target = `${sessionId}.jsonl`;
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsRoot);
  } catch {
    return null; // No projects root (fresh install, or wrong path).
  }

  for (const dir of projectDirs) {
    const candidate = join(projectsRoot, dir, target);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not in this project dir; keep looking.
    }
  }
  return null;
}

export interface TranscriptConversation {
  items: ConversationItem[];
  transcriptPath: string;
}

/**
 * Read a session's full conversation from its transcript, or null when there is
 * no readable transcript for the id.
 */
export function readTranscriptConversation(
  sessionId: string,
  projectsRoot = defaultProjectsRoot(),
): TranscriptConversation | null {
  const path = findTranscriptFile(sessionId, projectsRoot);
  if (!path) return null;
  try {
    const lines = readFileSync(path, 'utf8').split('\n');
    return { items: parseTranscriptToConversation(lines), transcriptPath: path };
  } catch {
    return null; // Unreadable (permissions, a directory shaped like the file, …).
  }
}

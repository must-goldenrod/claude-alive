import { readdir, stat, open } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';

/**
 * Index of past Claude Code sessions stored under `~/.claude/projects/<slug>/*.jsonl`.
 *
 * Claude Code slugifies the cwd by replacing every path separator with `-`. We rebuild
 * that slug to locate the project directory, then scan its `.jsonl` files.
 *
 * Each `.jsonl` holds a full transcript; to build a lightweight listing we read only:
 *   - the FIRST data line (for startedAt / cwd / first user prompt preview)
 *   - the file `mtime` (for lastActivity, cheaper than tailing the file)
 *   - the file size (coarse proxy for activity)
 *
 * This keeps cost bounded: one small read per session (≤4KB) regardless of transcript size.
 */

export interface ClaudeSessionSummary {
  sessionId: string;
  cwd: string;
  startedAt: number;
  lastActivity: number;
  /** First user message (first ~120 chars). Empty if not available. */
  preview: string;
  sizeBytes: number;
}

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const PREVIEW_READ_BYTES = 4096;
const PREVIEW_MAX_CHARS = 120;

function cwdToProjectSlug(absoluteCwd: string): string {
  // Claude Code's convention: every `/` becomes `-`, leading `/` keeps the `-`.
  return absoluteCwd.replace(/\//g, '-');
}

/** Read up to N bytes from the start of the file, decode UTF-8, return complete lines only. */
async function readHeadLines(filePath: string, maxBytes: number): Promise<string[]> {
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    // Keep only complete lines (drop a potentially truncated last line).
    const lines = text.split('\n');
    if (lines.length > 1) lines.pop();
    return lines.filter((l) => l.trim().length > 0);
  } finally {
    await fh.close();
  }
}

function extractPreview(lines: string[]): { startedAt: number; preview: string } {
  let startedAt = 0;
  let preview = '';

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (startedAt === 0) {
      const ts = obj['timestamp'];
      if (typeof ts === 'string') {
        const parsed = Date.parse(ts);
        if (!Number.isNaN(parsed)) startedAt = parsed;
      }
    }

    if (!preview && obj['type'] === 'user') {
      const message = obj['message'] as Record<string, unknown> | undefined;
      const content = message?.['content'];
      if (typeof content === 'string') {
        preview = content;
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (
            part &&
            typeof part === 'object' &&
            (part as Record<string, unknown>)['type'] === 'text' &&
            typeof (part as Record<string, unknown>)['text'] === 'string'
          ) {
            preview = (part as Record<string, unknown>)['text'] as string;
            break;
          }
        }
      }
    }

    if (startedAt && preview) break;
  }

  // Normalize preview: strip newlines, clamp length.
  preview = preview.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX_CHARS);
  return { startedAt, preview };
}

export async function listClaudeSessions(cwd: string): Promise<ClaudeSessionSummary[]> {
  // Validate & canonicalize the cwd to prevent directory traversal via the query string.
  const absCwd = resolve(cwd);
  const slug = cwdToProjectSlug(absCwd);
  const projectDir = join(CLAUDE_PROJECTS_DIR, slug);

  let entries: string[];
  try {
    entries = await readdir(projectDir);
  } catch {
    return [];
  }

  const jsonlFiles = entries.filter((n) => n.endsWith('.jsonl'));
  const summaries: ClaudeSessionSummary[] = [];

  for (const name of jsonlFiles) {
    const filePath = join(projectDir, name);
    const sessionId = basename(name, '.jsonl');

    try {
      const stats = await stat(filePath);
      const lines = await readHeadLines(filePath, PREVIEW_READ_BYTES);
      const { startedAt, preview } = extractPreview(lines);

      summaries.push({
        sessionId,
        cwd: absCwd,
        startedAt: startedAt || stats.mtimeMs,
        lastActivity: stats.mtimeMs,
        preview,
        sizeBytes: stats.size,
      });
    } catch {
      // Skip unreadable files silently.
    }
  }

  // Most-recent-activity first.
  summaries.sort((a, b) => b.lastActivity - a.lastActivity);
  return summaries;
}

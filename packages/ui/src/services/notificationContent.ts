/**
 * Builds the human-readable content shown in both the in-app toast and the OS-level
 * browser notification.
 *
 * Design rule: a notification must answer "which work, in which folder, at what stage"
 * without the reader opening the dashboard. It therefore never surfaces a sessionId or
 * the dashboard origin — those identify the tool, not the work. What it does surface:
 *
 *   <project> · <stage>
 *   Folder: claude-alive     (last path segment only — the full path is noise)
 *   Input:  "the prompt that started this, in full"
 *   Tool:   Bash            (only when a tool is involved)
 */

import i18n from '@claude-alive/i18n';

/** The three agent transitions that raise a notification. */
export type AlertKind = 'waiting' | 'error' | 'done';

export interface AlertContext {
  /** Resolved project label (user-defined name, or the cwd's last folder). */
  projectName?: string | null;
  /** Absolute working directory of the agent — the "root folder" of the work. */
  cwd?: string | null;
  /** User-assigned agent name; used as the headline only when no project is known. */
  displayName?: string | null;
  /** Tool awaiting approval / that failed. */
  tool?: string | null;
  /** Most recent user prompt, so the reader recognises which request this is about. */
  lastPrompt?: string | null;
}

export interface AlertContent {
  /** Headline: `<project> · <stage>`. */
  title: string;
  /** Detail lines, already labelled and translated. */
  lines: string[];
  /** `lines` joined with newlines — the Notification API body. */
  body: string;
  /** Stage label on its own, for the toast's coloured status row. */
  stage: string;
}

const STAGE_KEY: Record<AlertKind, string> = {
  waiting: 'notifications.needsPermission',
  error: 'notifications.errorOccurred',
  done: 'notifications.taskCompleted',
};

/**
 * The folder the work happens in, reduced to its last segment. The leading path is the
 * same for every project on the machine, so it costs notification width without telling
 * the reader anything they don't already know.
 */
export function folderLabel(cwd: string): string {
  const segments = cwd.split('/').filter((s) => s.trim().length > 0);
  return segments[segments.length - 1]?.trim() ?? '';
}

/**
 * The prompt as written — trimmed at the edges and with blank leading/trailing lines
 * dropped, but never clipped. The reader needs the whole request to recognise it; the
 * OS notification may truncate the tail, and the in-app toast renders it in full.
 */
export function normalizePrompt(prompt: string): string {
  return prompt.replace(/^\s*\n/g, '').trimEnd().split('\n').map((l) => l.trim()).join('\n').trim();
}

export function buildAlertContent(kind: AlertKind, ctx: AlertContext): AlertContent {
  const stage = i18n.t(STAGE_KEY[kind]);
  const cwd = ctx.cwd?.trim() || '';
  const folder = cwd ? folderLabel(cwd) : '';
  const project =
    ctx.projectName?.trim() ||
    folder ||
    ctx.displayName?.trim() ||
    i18n.t('notifications.unknownProject');

  const lines: string[] = [];
  if (folder) {
    lines.push(`${i18n.t('notifications.folder')}: ${folder}`);
  }
  // The agent's own name only adds information when it differs from the project label.
  if (ctx.displayName && ctx.displayName.trim() && ctx.displayName.trim() !== project) {
    lines.push(`${i18n.t('notifications.agent')}: ${ctx.displayName.trim()}`);
  }
  const prompt = ctx.lastPrompt ? normalizePrompt(ctx.lastPrompt) : '';
  if (prompt) {
    lines.push(`${i18n.t('notifications.input')}: "${prompt}"`);
  }
  if (ctx.tool && ctx.tool.trim()) {
    lines.push(`${i18n.t('notifications.tool')}: ${ctx.tool.trim()}`);
  }

  return { title: `${project} · ${stage}`, lines, body: lines.join('\n'), stage };
}

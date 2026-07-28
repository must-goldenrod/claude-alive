/**
 * Builds the human-readable content shown in both the in-app toast and the OS-level
 * browser notification.
 *
 * Design rule: a notification must answer "which work, in which folder, at what stage"
 * without the reader opening the dashboard. It therefore never surfaces a sessionId or
 * the dashboard origin — those identify the tool, not the work. What it does surface:
 *
 *   <project> · <stage>
 *   Folder: ~/path/to/root
 *   Input:  "the prompt that started this"
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

const MAX_PROMPT_CHARS = 80;
const MAX_PATH_SEGMENTS = 3;

/**
 * Shorten an absolute path for display: collapse the home prefix to `~` and keep only
 * the trailing segments, which are the ones that identify the project.
 */
export function shortenPath(cwd: string): string {
  const home = cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~');
  const segments = home.split('/').filter(Boolean);
  if (segments.length <= MAX_PATH_SEGMENTS) return home;
  return `…/${segments.slice(-MAX_PATH_SEGMENTS).join('/')}`;
}

/** First line of the prompt, collapsed and clipped — notifications get one line only. */
export function summarizePrompt(prompt: string): string {
  const firstLine = prompt.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  if (firstLine.length <= MAX_PROMPT_CHARS) return firstLine;
  return `${firstLine.slice(0, MAX_PROMPT_CHARS)}…`;
}

/** Last path component, used when the server has no explicit project name. */
function basename(cwd: string): string {
  const segments = cwd.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

export function buildAlertContent(kind: AlertKind, ctx: AlertContext): AlertContent {
  const stage = i18n.t(STAGE_KEY[kind]);
  const cwd = ctx.cwd?.trim() || '';
  const project =
    ctx.projectName?.trim() ||
    (cwd ? basename(cwd) : '') ||
    ctx.displayName?.trim() ||
    i18n.t('notifications.unknownProject');

  const lines: string[] = [];
  if (cwd) {
    lines.push(`${i18n.t('notifications.folder')}: ${shortenPath(cwd)}`);
  }
  // The agent's own name only adds information when it differs from the project label.
  if (ctx.displayName && ctx.displayName.trim() && ctx.displayName.trim() !== project) {
    lines.push(`${i18n.t('notifications.agent')}: ${ctx.displayName.trim()}`);
  }
  if (ctx.lastPrompt && summarizePrompt(ctx.lastPrompt)) {
    lines.push(`${i18n.t('notifications.input')}: "${summarizePrompt(ctx.lastPrompt)}"`);
  }
  if (ctx.tool && ctx.tool.trim()) {
    lines.push(`${i18n.t('notifications.tool')}: ${ctx.tool.trim()}`);
  }

  return { title: `${project} · ${stage}`, lines, body: lines.join('\n'), stage };
}

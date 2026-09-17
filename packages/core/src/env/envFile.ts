/**
 * Helpers for `~/.claude-alive/.env` and `~/.claude-alive/models.json`, shared by
 * the server (dashboard gateway settings) and anything else that edits `~/.claude-alive/.env`.
 */
import { lstatSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function envLineKey(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;
  const eq = trimmed.indexOf('=');
  return eq > 0 ? trimmed.slice(0, eq).replace(/^export\s+/, '').trim() : undefined;
}

/**
 * Set `key=value` in env-file text, replacing an existing line in place or
 * appending one. `undefined`/empty removes the key. Other lines are untouched.
 */
export function upsertEnvValue(text: string, key: string, value: string | undefined): string {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid env key "${key}"`);
  if (value !== undefined && /[\r\n]/.test(value)) throw new Error(`Value for ${key} must be a single line`);
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => envLineKey(line) === key);
  const remove = value === undefined || value === '';
  if (index !== -1) {
    const replacement = remove ? [] : [`${key}=${value}`];
    return [...lines.slice(0, index), ...replacement, ...lines.slice(index + 1)].join('\n');
  }
  if (remove) return text;
  const separator = text.length > 0 && !text.endsWith('\n') ? '\n' : '';
  return `${text}${separator}${key}=${value}\n`;
}

/** Read one key from env-file text (first match; one quote layer stripped). */
export function readEnvKey(text: string, key: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (envLineKey(line) !== key) continue;
    const raw = line.slice(line.indexOf('=') + 1).trim();
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    return quoted ? quoted[2]! : raw;
  }
  return undefined;
}

/** Model ids from an OpenAI-compatible `GET /v1/models` body (`{ data: [{ id }] }`). */
export function parseModelIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
    .map((id) => id.trim());
  return [...new Set(ids)].sort();
}

/**
 * A starter models.json for a freshly discovered gateway: every served model,
 * the chosen default first. Kinds and notes are left generic — the user edits
 * them to steer which model the orchestrator picks for what.
 */
export function buildModelsFile(ids: readonly string[], defaultModel: string): Record<string, unknown> {
  const ordered = [defaultModel, ...ids.filter((id) => id !== defaultModel)];
  return {
    defaultModel,
    models: ordered.map((id) => ({ id, aliases: [], kind: 'utility', note: '', fallbacks: [] })),
  };
}

/** Write a config file 0600, refusing to follow a symlink planted at the path. */
export function writePrivateFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  // lstat, not existsSync: a dangling symlink "does not exist" yet would still be followed.
  let isLink = false;
  try {
    isLink = lstatSync(path).isSymbolicLink();
  } catch {
    // no file yet
  }
  if (isLink) throw new Error(`${path} is a symlink — refusing to write through it`);
  writeFileSync(path, text, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch (error) {
    process.stderr.write(`  ! could not chmod 600 ${path}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

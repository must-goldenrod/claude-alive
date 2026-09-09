/**
 * Device tokens in `~/.claude-alive/.env`.
 *
 * One file, one format (`KEY=VALUE`), already read by the server — so remote
 * device tokens live there too rather than in a second store the user has to
 * learn about. `CLAUDE_ALIVE_TOKENS` holds `label:value` entries so a lost
 * phone can be revoked by name without rotating every other device.
 *
 * These are pure text transforms: the CLI owns reading and writing the file,
 * which keeps the parsing testable without touching a filesystem.
 */

const TOKENS_KEY = 'CLAUDE_ALIVE_TOKENS';

export interface DeviceToken {
  label: string;
  value: string;
}

/** A label appears between `=` and `:`, so neither may occur inside it. */
const LABEL_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

/** Read one `KEY=VALUE` from env-file text; `export` and one quote layer are tolerated. */
export function readEnvValue(text: string, key: string): string | undefined {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    if (line.slice(0, eq).replace(/^export\s+/, '').trim() !== key) continue;
    const raw = line.slice(eq + 1).trim();
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    return quoted ? quoted[2]! : raw;
  }
  return undefined;
}

export function listDeviceTokens(text: string): DeviceToken[] {
  const raw = readEnvValue(text, TOKENS_KEY);
  if (!raw) return [];
  const out: DeviceToken[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep <= 0) continue;
    out.push({ label: trimmed.slice(0, sep), value: trimmed.slice(sep + 1) });
  }
  return out;
}

/** Rewrite (or append) the tokens line, leaving every other line alone. */
function writeTokens(text: string, tokens: readonly DeviceToken[]): string {
  const lines = text.split(/\r?\n/);
  const rendered = tokens.map((t) => `${t.label}:${t.value}`).join(',');
  const index = lines.findIndex((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return false;
    const eq = trimmed.indexOf('=');
    return eq > 0 && trimmed.slice(0, eq).replace(/^export\s+/, '').trim() === TOKENS_KEY;
  });

  if (tokens.length === 0) {
    if (index === -1) return text;
    const kept = [...lines.slice(0, index), ...lines.slice(index + 1)];
    return kept.join('\n');
  }
  const line = `${TOKENS_KEY}=${rendered}`;
  if (index !== -1) {
    return [...lines.slice(0, index), line, ...lines.slice(index + 1)].join('\n');
  }
  const separator = text.length > 0 && !text.endsWith('\n') ? '\n' : '';
  return `${text}${separator}${line}\n`;
}

export function addDeviceToken(text: string, label: string, value: string): string {
  if (!LABEL_PATTERN.test(label)) {
    throw new Error(`Invalid device label "${label}" — use letters, digits, dot, dash or underscore.`);
  }
  // Replacing rather than appending: two tokens under one name make "revoke the
  // phone" ambiguous, which is the one operation this list exists for.
  const kept = listDeviceTokens(text).filter((t) => t.label !== label);
  return writeTokens(text, [...kept, { label, value }]);
}

export function revokeDeviceToken(text: string, label: string): string {
  const current = listDeviceTokens(text);
  const kept = current.filter((t) => t.label !== label);
  if (kept.length === current.length) return text;
  return writeTokens(text, kept);
}

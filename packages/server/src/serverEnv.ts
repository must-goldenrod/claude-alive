/**
 * Server-side env file loading (`~/.claude-alive/.env`).
 *
 * The server is started as a detached daemon (`claude-alive start`, launchd),
 * so it does not inherit the interactive shell's exports. Keys the orchestrator
 * needs — `LITELLM_KEY` above all — therefore have to come from a file the
 * daemon reads itself. Values already present in the process env always win, so
 * an explicit `LITELLM_KEY=… claude-alive start` still overrides the file.
 *
 * Deliberately not `dotenv`: one format (`KEY=VALUE`, `#` comments, optional
 * surrounding quotes), no expansion, no dependency.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Default location; the CLI documents this path for `LITELLM_KEY`. */
export const SERVER_ENV_FILE = join(homedir(), '.claude-alive', '.env');

/**
 * Parse `KEY=VALUE` lines. Blank lines and `#` comments are skipped, a leading
 * `export ` is tolerated, and one layer of matching quotes is stripped so a
 * value with spaces survives. Malformed lines are ignored rather than throwing —
 * a typo in the env file must not stop the server from booting.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const raw = line.slice(eq + 1).trim();
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    out[key] = quoted ? quoted[2]! : raw;
  }
  return out;
}

export interface LoadServerEnvDeps {
  /** Read the file; throwing (e.g. ENOENT) means "no env file", not an error. */
  read?: (path: string) => string;
  /** Target to mutate (tests pass a plain object; production passes process.env). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Merge `~/.claude-alive/.env` into the process env without overwriting values
 * that are already set. Returns the keys that were actually applied so startup
 * can log which config came from the file (never the values).
 */
export function loadServerEnv(path: string = SERVER_ENV_FILE, deps: LoadServerEnvDeps = {}): string[] {
  const read = deps.read ?? ((p: string) => readFileSync(p, 'utf-8'));
  const env = deps.env ?? process.env;
  let text: string;
  try {
    text = read(path);
  } catch {
    return [];
  }
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parseEnvFile(text))) {
    if (env[key] !== undefined && env[key] !== '') continue;
    env[key] = value;
    applied.push(key);
  }
  return applied;
}

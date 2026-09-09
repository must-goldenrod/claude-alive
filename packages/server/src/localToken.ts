/**
 * The local full-access token.
 *
 * Once remote mode is on, "the request came from 127.0.0.1" stops being proof
 * of anything (a tunnel forges it). What a tunnel cannot forge is read access
 * to a 0600 file in the user's home, so that is what local components — the
 * hook script, the CLI, the dashboard this server serves — present instead.
 *
 * Generated rather than asked for: the alternative is a server that refuses to
 * boot until the user invents a second secret, and the first thing they would
 * do is reuse the device token.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LocalTokenDeps {
  read?: (path: string) => string;
  write?: (path: string, text: string) => void;
  chmod?: (path: string, mode: number) => void;
  generate?: () => string;
}

export function ensureLocalToken(
  envFile: string,
  env: NodeJS.ProcessEnv,
  deps: LocalTokenDeps = {},
): string {
  const existing = env.CLAUDE_ALIVE_LOCAL_TOKEN?.trim();
  if (existing) return existing;

  const read = deps.read ?? ((p: string) => readFileSync(p, 'utf-8'));
  const write =
    deps.write ??
    ((p: string, text: string) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text, { mode: 0o600 });
    });
  const chmod = deps.chmod ?? ((p: string, mode: number) => chmodSync(p, mode));
  const generate = deps.generate ?? (() => randomBytes(32).toString('base64url'));

  const token = generate();
  let current = '';
  try {
    current = read(envFile);
  } catch {
    // No env file yet — this write creates it.
  }
  const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  write(envFile, `${current}${separator}CLAUDE_ALIVE_LOCAL_TOKEN=${token}\n`);
  // The file may predate this write with looser permissions.
  try {
    chmod(envFile, 0o600);
  } catch {
    // A filesystem without POSIX modes; the write above still used 0600.
  }
  env.CLAUDE_ALIVE_LOCAL_TOKEN = token;
  return token;
}

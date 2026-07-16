import { homedir } from 'node:os';

/**
 * Ensure a child process can find user-installed CLIs (notably `claude`, commonly
 * at ~/.local/bin or ~/.npm-global/bin). When the server runs under launchd its
 * PATH is a minimal system PATH, so a bare `claude` fails with "command not
 * found". Prepend the common user bin dirs (deduped, order-preserving) so
 * resolution works no matter how the server was launched.
 *
 * `home` is injectable for testing; it defaults to the real home directory.
 */
export function augmentPath(basePath: string | undefined, home: string = homedir()): string {
  const preferred = [
    `${home}/.local/bin`,
    `${home}/.npm-global/bin`,
    `${home}/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  // System essentials, guaranteed present even when the inherited PATH is empty.
  const tail = ['/usr/bin', '/bin'];
  const existing = (basePath ?? '').split(':').filter(Boolean);
  // Order: user dirs first, then the inherited PATH (order preserved), then
  // system essentials — deduped, first occurrence wins.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of [...preferred, ...existing, ...tail]) {
    if (!seen.has(p)) {
      seen.add(p);
      result.push(p);
    }
  }
  return result.join(':');
}

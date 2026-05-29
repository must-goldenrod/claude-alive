import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regression guard for the prompt-collection outage (see stream-event.sh
 * header comment): the hook script must POST the event synchronously. A
 * previous version backgrounded curl (`curl ... &`) and exited immediately,
 * killing the request before it reached the server, so every Claude Code
 * event was silently dropped. These tests lock the script shape so that bug
 * can't regress.
 */
describe('stream-event.sh hook script', () => {
  const scriptPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'scripts',
    'stream-event.sh'
  );
  const script = readFileSync(scriptPath, 'utf-8');

  it('posts to the local /api/event endpoint with curl', () => {
    expect(script).toContain('curl');
    expect(script).toContain('/api/event');
  });

  it('reads the payload from stdin (no shell-interpolated variable)', () => {
    // --data-binary @- pipes stdin verbatim; this both avoids shell injection
    // and is the only transport Claude Code offers for the hook JSON payload.
    expect(script).toContain('--data-binary @-');
  });

  it('does NOT background the curl request (the fire-and-forget bug)', () => {
    // A trailing `&` detaches a command; combined with the script's immediate
    // `exit 0` that kills the request mid-flight. `2>&1` ends in `1`, so a real
    // trailing ampersand is the only thing this matches.
    const backgroundedLine = script
      .split('\n')
      .find((line) => /&\s*$/.test(line));
    expect(
      backgroundedLine,
      `unexpected backgrounded command: ${backgroundedLine}`
    ).toBeUndefined();
  });

  it('bounds the request with a curl timeout shorter than the hook timeout', () => {
    // `-m 2` caps the foreground wait at 2s; the hook's own timeout is 5s, so
    // blocking synchronously can never stall a Claude Code turn.
    expect(script).toMatch(/-m\s+2\b/);
  });
});

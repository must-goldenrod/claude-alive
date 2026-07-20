/**
 * Guards the Codex mapper against protocol drift (spec §U "공급자 프로토콜 변경").
 *
 * The fixture is the method inventory emitted by
 * `codex app-server generate-json-schema` for a known version. If the mapper ever
 * handles a method that version does not define, it is acting on an assumption —
 * exactly the failure that produced a `turn/failed` branch which never existed.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexEventToCanonical } from '../codexToCanonical.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const protocol = JSON.parse(
  readFileSync(join(HERE, '..', '__fixtures__', 'codex', 'protocol-0.144.6.json'), 'utf8'),
) as { codexVersion: string; serverNotifications: string[]; serverRequests: string[] };

const KNOWN = new Set([...protocol.serverNotifications, ...protocol.serverRequests]);

/** Every method the mapper claims to understand. */
const HANDLED = [
  'thread/started',
  'thread/status/changed',
  'turn/started',
  'turn/completed',
  'error',
  'item/started',
  'item/completed',
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'thread/tokenUsage/updated',
];

const ctx = { sessionId: 'S', workspaceId: 'W', receivedAt: 1, newEventId: () => 'E' };

describe(`codex protocol ${protocol.codexVersion}`, () => {
  test('every method the mapper handles exists in the generated schema', () => {
    const unknown = HANDLED.filter((m) => !KNOWN.has(m));
    expect(unknown).toEqual([]);
  });

  test('the mapper actually produces an event for each handled method', () => {
    // A method listed as handled but falling through to `default` would be a
    // silent no-op, indistinguishable from an unsupported method.
    const silent = HANDLED.filter((method) => {
      const params =
        method === 'item/started' || method === 'item/completed'
          ? { item: { id: 'i', type: 'commandExecution' } }
          : method === 'turn/started' || method === 'turn/completed'
            ? { turn: { id: 't', status: 'completed' } }
            : method === 'thread/started'
              ? { thread: { id: 'th', cwd: '/x' } }
              : method === 'thread/status/changed'
                ? { status: { type: 'idle' } }
                : { callId: 'a', usage: {}, error: { message: 'e' } };
      return codexEventToCanonical({ method, params }, ctx).length === 0;
    });
    expect(silent).toEqual([]);
  });

  test('there is no turn/failed notification in this protocol version', () => {
    // Recorded because an earlier mapper invented one.
    expect(KNOWN.has('turn/failed')).toBe(false);
  });

  test('the inventory is non-trivial, so an empty fixture cannot pass silently', () => {
    expect(protocol.serverNotifications.length).toBeGreaterThan(20);
    expect(protocol.serverRequests.length).toBeGreaterThan(3);
  });
});

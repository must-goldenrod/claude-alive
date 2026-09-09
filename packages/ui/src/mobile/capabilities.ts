/**
 * What the server will let this device do, asked once at startup.
 *
 * Without it the app cannot tell a refused WebSocket message from a broken
 * connection — the server drops both silently — so the terminal controls would
 * be rendered and simply not work.
 */
export type RemoteTerminalLevel = 'off' | 'watch' | 'input' | 'shell';

export interface RemoteCapabilities {
  terminal: RemoteTerminalLevel;
  remote: boolean;
}

const LEVELS: readonly RemoteTerminalLevel[] = ['off', 'watch', 'input', 'shell'];

export function parseCapabilities(value: unknown): RemoteCapabilities {
  const record = (value ?? {}) as Partial<RemoteCapabilities>;
  const terminal = LEVELS.includes(record.terminal as RemoteTerminalLevel)
    ? (record.terminal as RemoteTerminalLevel)
    : 'off';
  return { terminal, remote: record.remote === true };
}

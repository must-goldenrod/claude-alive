import { describe, it, expect } from 'vitest';
import { parseClientMessage } from '../wsClientSchema.js';

describe('parseClientMessage', () => {
  it('accepts a well-formed terminal:spawn', () => {
    const msg = parseClientMessage(
      JSON.stringify({ type: 'terminal:spawn', tabId: 'T1', cwd: '/tmp', mode: 'claude' }),
    );
    expect(msg).toEqual({ type: 'terminal:spawn', tabId: 'T1', cwd: '/tmp', mode: 'claude' });
  });

  it('accepts ping and request:snapshot', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'ping' }))).toEqual({ type: 'ping' });
    expect(parseClientMessage(JSON.stringify({ type: 'request:snapshot' }))).toEqual({
      type: 'request:snapshot',
    });
  });

  it('rejects non-string tabId', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'terminal:input', tabId: 42, data: 'x' }))).toBeNull();
  });

  it('rejects an empty tabId', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'terminal:close', tabId: '' }))).toBeNull();
  });

  it('rejects a non-string cwd on spawn', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'terminal:spawn', tabId: 'T1', cwd: { evil: true } })),
    ).toBeNull();
  });

  it('rejects an unknown message type', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'terminal:nuke', tabId: 'T1' }))).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parseClientMessage('{ not json')).toBeNull();
  });

  it('rejects non-integer resize dimensions', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'terminal:resize', tabId: 'T1', cols: 1.5, rows: 24 })),
    ).toBeNull();
  });
});

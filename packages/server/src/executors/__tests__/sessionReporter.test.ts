import { describe, it, expect, vi } from 'vitest';
import { sessionIdReporter } from '../sessionReporter.js';
import type { StreamEvent } from '../../streamJson.js';

function result(sessionId: string | null): StreamEvent {
  return { kind: 'result', result: { result: 'r', isError: false, sessionId, model: null, usage: null } } as StreamEvent;
}

describe('sessionIdReporter', () => {
  it('reports the id from the init event', () => {
    const seen = vi.fn();
    const on = sessionIdReporter(seen);
    on({ kind: 'init', sessionId: 'sess-1' });
    expect(seen).toHaveBeenCalledWith('sess-1');
  });

  it('reports each id only once', () => {
    const seen = vi.fn();
    const on = sessionIdReporter(seen);
    on({ kind: 'init', sessionId: 'sess-1' });
    on(result('sess-1'));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('reports a changed id (a resumed run can report a different session)', () => {
    const seen = vi.fn();
    const on = sessionIdReporter(seen);
    on({ kind: 'init', sessionId: 'sess-1' });
    on(result('sess-2'));
    expect(seen).toHaveBeenNthCalledWith(2, 'sess-2');
  });

  it('ignores events without an id', () => {
    const seen = vi.fn();
    const on = sessionIdReporter(seen);
    on({ kind: 'init', sessionId: null });
    on(result(null));
    expect(seen).not.toHaveBeenCalled();
  });
});

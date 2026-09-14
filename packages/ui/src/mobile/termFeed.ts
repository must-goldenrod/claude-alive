/**
 * The pipe between the socket and the phone's xterm.
 *
 * Terminal bytes are a stream, not state: holding them in React state would
 * re-render on every frame and re-feed the whole buffer to the emulator. The
 * socket pushes events here and the mounted terminal drains them. Events that
 * arrive before the terminal mounts (spawn output racing the first render) are
 * held and handed over on `listen`.
 */
export type TermEvent =
  | { kind: 'data'; data: string }
  | { kind: 'reset' }
  | { kind: 'size'; cols: number; rows: number };

export interface TermFeed {
  push: (event: TermEvent) => void;
  /** Attach the single consumer; returns the detach function. */
  listen: (fn: (event: TermEvent) => void) => () => void;
}

export function createTermFeed(): TermFeed {
  let listener: ((event: TermEvent) => void) | undefined;
  let pending: TermEvent[] = [];
  return {
    push(event) {
      if (listener) listener(event);
      else pending = [...pending, event];
    },
    listen(fn) {
      listener = fn;
      const queued = pending;
      pending = [];
      for (const event of queued) fn(event);
      return () => {
        if (listener === fn) listener = undefined;
      };
    },
  };
}

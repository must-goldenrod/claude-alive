/**
 * Coalesced "the catalog changed, refetch" signal.
 *
 * Two things this has to survive. A busy session emits several catalog events
 * per second and the client only needs to hear "refetch" once — hence the
 * window. And the first signal can arrive *during boot*: the one-time legacy
 * import fires one while the server module is still suspended on a top-level
 * await, before the WebSocket broadcaster exists. Reaching for the broadcaster
 * then throws and kills the process before it ever binds a port, so the sink is
 * connected explicitly and a signal with no sink is dropped — nobody is
 * listening yet by definition.
 */
export interface CatalogChangedMessage {
  type: 'v2:catalog-changed';
}

export type CatalogSink = (message: CatalogChangedMessage) => void;

export interface CatalogSignal {
  /** Ask for a refetch to be announced within the coalescing window. */
  signal: () => void;
  /** Wire the sink once it exists. Signals before this are dropped. */
  connect: (sink: CatalogSink) => void;
}

export interface CatalogSignalOptions {
  windowMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
}

export function createCatalogSignal(options: CatalogSignalOptions = {}): CatalogSignal {
  const windowMs = options.windowMs ?? 300;
  const schedule = options.schedule ?? setTimeout;
  let pending = false;
  let sink: CatalogSink | null = null;

  return {
    signal: () => {
      if (pending) return;
      pending = true;
      schedule(() => {
        pending = false;
        sink?.({ type: 'v2:catalog-changed' });
      }, windowMs);
    },
    connect: (next) => {
      sink = next;
    },
  };
}

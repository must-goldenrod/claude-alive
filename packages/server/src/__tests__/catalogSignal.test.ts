import { describe, it, expect, vi } from 'vitest';
import { createCatalogSignal } from '../catalogSignal.js';

/** Collects scheduled callbacks so the test drives the clock. */
function manualSchedule() {
  const queue: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => { queue.push(fn); return 0; },
    run: () => { const pending = queue.splice(0); for (const fn of pending) fn(); },
    size: () => queue.length,
  };
}

describe('createCatalogSignal', () => {
  it('coalesces a burst into one announcement', () => {
    const clock = manualSchedule();
    const sink = vi.fn();
    const signal = createCatalogSignal({ schedule: clock.schedule });
    signal.connect(sink);
    signal.signal();
    signal.signal();
    signal.signal();
    expect(clock.size()).toBe(1);
    clock.run();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({ type: 'v2:catalog-changed' });
  });

  it('drops a signal fired before the sink exists instead of throwing', () => {
    // The boot crash this guards: the legacy import signals while the server is
    // still starting, and dereferencing the broadcaster there killed the process
    // before it bound a port.
    const clock = manualSchedule();
    const signal = createCatalogSignal({ schedule: clock.schedule });
    signal.signal();
    expect(() => clock.run()).not.toThrow();
  });

  it('announces again after the window closes', () => {
    const clock = manualSchedule();
    const sink = vi.fn();
    const signal = createCatalogSignal({ schedule: clock.schedule });
    signal.connect(sink);
    signal.signal();
    clock.run();
    signal.signal();
    clock.run();
    expect(sink).toHaveBeenCalledTimes(2);
  });
});

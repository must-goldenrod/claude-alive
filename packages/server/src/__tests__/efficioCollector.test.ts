import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEfficioCollector } from '../efficioCollector.js';

describe('efficioCollector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does nothing when efficioRoot is null (auto-collect disabled)', async () => {
    const runCollect = vi.fn().mockResolvedValue(undefined);
    const c = createEfficioCollector({ efficioRoot: null, python: 'python3', debounceMs: 100, runCollect });
    c.schedule();
    c.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(runCollect).not.toHaveBeenCalled();
  });

  it('debounces a burst of schedules into a single run', async () => {
    const runCollect = vi.fn().mockResolvedValue(undefined);
    const c = createEfficioCollector({ efficioRoot: '/root', python: 'py', debounceMs: 100, runCollect });
    c.schedule();
    c.schedule();
    c.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(runCollect).toHaveBeenCalledTimes(1);
    expect(runCollect).toHaveBeenCalledWith('/root', 'py');
  });

  it('coalesces a schedule arriving mid-run into exactly one follow-up run', async () => {
    let releaseFirst: () => void = () => {};
    const runCollect = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((res) => { releaseFirst = res; }))
      .mockResolvedValue(undefined);
    const c = createEfficioCollector({ efficioRoot: '/root', python: 'py', debounceMs: 100, runCollect });

    c.schedule();
    await vi.advanceTimersByTimeAsync(100); // first run starts, stays pending
    expect(runCollect).toHaveBeenCalledTimes(1);

    c.schedule(); // arrives while first run in flight
    await vi.advanceTimersByTimeAsync(100); // debounce fires but run busy → marked pending

    releaseFirst(); // first run finishes → triggers the single coalesced follow-up
    await vi.runAllTimersAsync();
    expect(runCollect).toHaveBeenCalledTimes(2);
  });

  it('reports failure (fail-open) and recovers on next schedule', async () => {
    const onLog = vi.fn();
    const runCollect = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const c = createEfficioCollector({ efficioRoot: '/root', python: 'py', debounceMs: 10, runCollect, onLog });

    c.schedule();
    await vi.advanceTimersByTimeAsync(10);
    expect(onLog).toHaveBeenCalled();

    c.schedule();
    await vi.advanceTimersByTimeAsync(10);
    expect(runCollect).toHaveBeenCalledTimes(2);
  });

  it('stop() cancels a pending debounce', async () => {
    const runCollect = vi.fn().mockResolvedValue(undefined);
    const c = createEfficioCollector({ efficioRoot: '/root', python: 'py', debounceMs: 100, runCollect });
    c.schedule();
    c.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(runCollect).not.toHaveBeenCalled();
  });
});

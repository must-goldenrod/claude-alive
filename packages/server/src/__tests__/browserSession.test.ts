import { describe, expect, it, vi } from 'vitest';
import { openBrowserSession, withBrowserSession } from '../browser/session.js';

/**
 * Stand-ins for the two objects a real session owns: the Chrome we launched
 * ourselves, and the Stagehand client attached to it. The leak this file guards
 * against is closing only the second one.
 */
function fakes() {
  const browser = {
    closed: false,
    close: vi.fn(async () => {
      browser.closed = true;
    }),
    context: { newPage: async () => ({}) },
  };
  // Stagehand exposes the browser it was handed; the session reads its page
  // from there, which is exactly why closing only Stagehand looked sufficient.
  const stagehand = { browser, close: vi.fn(async () => {}) };
  return {
    browser,
    stagehand,
    deps: {
      launch: async () => browser as never,
      createStagehand: async () => stagehand as never,
    },
  };
}

describe('openBrowserSession — teardown', () => {
  it('closes the browser it launched, not only the Stagehand client', async () => {
    const { browser, stagehand, deps } = fakes();

    const session = await openBrowserSession({ backend: 'none' }, deps);
    await session.close();

    expect(stagehand.close).toHaveBeenCalledTimes(1);
    // Without this the Chrome child process and its CDP socket stay open, the
    // Node process never exits, and browsers pile up one per run.
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('closes the browser even when the Stagehand client fails to close', async () => {
    const { browser, stagehand, deps } = fakes();
    stagehand.close.mockRejectedValueOnce(new Error('websocket already gone'));

    const session = await openBrowserSession({ backend: 'none' }, deps);
    await session.close();

    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second close does not re-close anything', async () => {
    const { browser, stagehand, deps } = fakes();

    const session = await openBrowserSession({ backend: 'none' }, deps);
    await session.close();
    await session.close();

    expect(stagehand.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the browser refuses to close — teardown is best effort', async () => {
    const { browser, deps } = fakes();
    browser.close.mockRejectedValueOnce(new Error('already dead'));

    const session = await openBrowserSession({ backend: 'none' }, deps);
    await expect(session.close()).resolves.toBeUndefined();
  });
});

describe('withBrowserSession — teardown', () => {
  it('closes the browser after the callback returns', async () => {
    const { browser, deps } = fakes();
    await withBrowserSession({ backend: 'none' }, async () => 'done', deps);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('closes the browser when the callback throws', async () => {
    const { browser, deps } = fakes();
    await expect(
      withBrowserSession({ backend: 'none' }, async () => {
        throw new Error('check blew up');
      }, deps),
    ).rejects.toThrow('check blew up');
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});

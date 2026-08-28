import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireNotification } from '../services/notifications.ts';

interface FakeNotificationInit {
  body?: string;
  tag?: string;
  requireInteraction?: boolean;
}

const constructed: Array<{ title: string; init: FakeNotificationInit }> = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  onclick: (() => void) | null = null;
  constructor(title: string, init: FakeNotificationInit = {}) {
    constructed.push({ title, init });
  }
  close() {}
}

/**
 * This environment's `localStorage` is a bare object without the Storage
 * methods, so the service's reads/writes throw instead of returning a value.
 * A minimal in-memory store makes the preference actually readable under test.
 */
function installMemoryStorage(): Map<string, string> {
  const bag = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => { bag.set(k, String(v)); },
    removeItem: (k: string) => { bag.delete(k); },
    clear: () => bag.clear(),
    key: (i: number) => [...bag.keys()][i] ?? null,
    get length() { return bag.size; },
  });
  return bag;
}

describe('fireNotification', () => {
  beforeEach(() => {
    constructed.length = 0;
    installMemoryStorage();
    localStorage.setItem('claude-alive:notifications-enabled', '1');
    FakeNotification.permission = 'granted';
    vi.stubGlobal('Notification', FakeNotification);
  });

  it('fires even while the dashboard tab is focused — the OS notification is the primary surface', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const fired = fireNotification({ title: 'api · Needs permission', body: 'Folder: /srv/api', tag: 'a:waiting' });
    expect(fired).toBe(true);
    expect(constructed).toHaveLength(1);
    expect(constructed[0].title).toBe('api · Needs permission');
    expect(constructed[0].init.body).toBe('Folder: /srv/api');
  });

  it('does not fire when permission was not granted', () => {
    FakeNotification.permission = 'denied';
    expect(fireNotification({ title: 't', body: 'b', tag: 'x' })).toBe(false);
    expect(constructed).toHaveLength(0);
  });

  it('does not fire when the user turned notifications off', () => {
    localStorage.setItem('claude-alive:notifications-enabled', '0');
    expect(fireNotification({ title: 't', body: 'b', tag: 'x' })).toBe(false);
    expect(constructed).toHaveLength(0);
  });
});

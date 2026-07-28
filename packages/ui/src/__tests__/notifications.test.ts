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

describe('fireNotification', () => {
  beforeEach(() => {
    constructed.length = 0;
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

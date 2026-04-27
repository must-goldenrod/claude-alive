/**
 * Browser native notification service.
 *
 * Wraps the Web Notification API with:
 * - Permission caching in localStorage (so UI knows to show "enable" CTA)
 * - Per-event-type toggle (waiting / error) — currently both bundled under one switch
 * - Focus-aware suppression (when the dashboard tab is focused, in-app toasts already
 *   convey the same info, so we don't double-notify)
 * - Dedupe via the Notification `tag` option (same agent + event won't stack in the
 *   OS notification center)
 *
 * localhost is treated as a secure context by all major browsers, so this works on
 * the dev server without HTTPS.
 */

const STORAGE_KEY = 'claude-alive:notifications-enabled';

/** Whether the browser supports native notifications at all. */
export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Current permission as reported by the browser. */
export function currentPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/** User's stored preference. Defaults to true once permission is granted. */
export function notificationsEnabled(): boolean {
  if (!notificationsSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  // Default ON when permission was just granted; respect explicit OFF afterwards.
  return stored === null ? true : stored === '1';
}

export function setNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
}

/**
 * Request notification permission from the user.
 *
 * MUST be called from within a user-gesture handler (button click) — browsers reject
 * `requestPermission()` calls outside user activation and the prompt won't appear.
 *
 * Returns the resulting permission state.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      // Default to ON after fresh grant unless previously explicitly disabled.
      if (localStorage.getItem(STORAGE_KEY) === null) {
        setNotificationsEnabled(true);
      }
    }
    return result;
  } catch {
    return 'denied';
  }
}

export interface FireOptions {
  /** Header-line text. Keep ≤ 50 chars; macOS truncates. */
  title: string;
  /** Body text. Keep ≤ ~120 chars. */
  body: string;
  /**
   * Stable identifier — the OS notification center merges/replaces existing notifications
   * with the same tag. Use `${sessionId}:${kind}` to dedupe per-agent events.
   */
  tag: string;
  /**
   * When true, the notification stays visible until the user dismisses it. Use for
   * errors and permission requests that must be acknowledged. Default false.
   */
  requireInteraction?: boolean;
  /**
   * Optional click handler. Defaults to `window.focus()` so clicking the OS notification
   * brings the dashboard tab to front.
   */
  onClick?: () => void;
}

/**
 * Fire a native browser notification if the user has granted permission AND the tab
 * isn't currently focused (focused tabs already get in-app toasts).
 *
 * Returns true if a notification was actually shown, false otherwise (no permission,
 * disabled in settings, focused tab, or unsupported browser).
 */
export function fireNotification(opts: FireOptions): boolean {
  if (!notificationsSupported()) return false;
  if (!notificationsEnabled()) return false;
  // Don't double-notify when the user is already looking at the dashboard.
  if (typeof document !== 'undefined' && document.hasFocus()) return false;

  try {
    const notif = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      requireInteraction: opts.requireInteraction ?? false,
    });
    notif.onclick = () => {
      window.focus();
      notif.close();
      opts.onClick?.();
    };
    return true;
  } catch {
    // Some browsers throw when permission flips between checks (rare race).
    return false;
  }
}

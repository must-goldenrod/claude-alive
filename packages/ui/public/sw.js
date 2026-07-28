/**
 * Minimal service worker.
 *
 * Its only job is to make the dashboard installable: Chrome requires a manifest AND a
 * registered service worker with a fetch handler before it offers "Install app". Once
 * installed, OS notifications are attributed to the app name instead of the
 * `localhost:3141` origin line the browser stamps on every web notification.
 *
 * It deliberately does NOT cache. The dashboard is a live WebSocket view of local
 * agents — a stale cached shell would be worse than a slow load, and cache invalidation
 * across `claude-alive` upgrades would be a standing source of "why is my UI old" bugs.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

/**
 * Notification sound service.
 *
 * Why this exists as its own module (vs. inline `new Audio().play()` calls):
 *
 * 1. **Autoplay policy.** Browsers reject `HTMLMediaElement.play()` until the
 *    document has received a user gesture ("sticky activation"). A passive
 *    monitoring dashboard is often opened and watched without a single click,
 *    so WebSocket-triggered sounds were silently rejected. `installAudioUnlock()`
 *    primes playback on the first real interaction so later event-driven sounds
 *    succeed.
 *
 * 2. **Safari's stricter rule.** Safari only allows programmatic `play()` on an
 *    element whose *first* play happened inside a user gesture. Creating a fresh
 *    `new Audio()` per event re-triggers the block every time. We therefore keep
 *    one reusable element per sound kind and prime each during the unlock gesture.
 *
 * 3. **Debounce + dedupe.** `agent:completed` and a `non-idle → idle` transition
 *    can arrive together; per-key debouncing collapses the duplicate. The dedupe
 *    map is pruned on a TTL so long-lived sessions don't accumulate entries.
 */

import { getSettings } from './settings';

type SoundKind = 'completion' | 'error' | 'waiting';

const URLS: Record<SoundKind, string> = {
  completion: '/assets/complete_sound.mp3',
  error: '/assets/error_sound.mp3',
  // Dedicated two-note "needs your decision" chime — deliberately distinct from
  // the completion sound so a blocking decision request (actionable) is
  // distinguishable by ear from a benign task completion.
  waiting: '/assets/waiting_sound.wav',
};

// Debounce window per dedupe key, to avoid double-firing when both
// `agent:completed` and a `non-idle → idle` transition arrive close together.
const SOUND_DEBOUNCE_MS = 800;
// Dedupe entries older than this are pruned so the map can't grow unbounded
// across a long-running dashboard session.
const DEDUPE_TTL_MS = 60_000;

const lastPlayedAt = new Map<string, number>();

// One reusable element per sound kind. Reusing the SAME element is required for
// Safari (see module doc). Lazily created so this module is import-safe in
// non-browser/test environments where `Audio` may be undefined.
const elements: Partial<Record<SoundKind, HTMLAudioElement>> = {};

let audioUnlocked = false;
let warnedBlocked = false;

function getElement(kind: SoundKind): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  let el = elements[kind];
  if (!el) {
    el = new Audio(URLS[kind]);
    el.preload = 'auto';
    elements[kind] = el;
  }
  return el;
}

function pruneDedupe(now: number): void {
  for (const [key, ts] of lastPlayedAt) {
    if (now - ts > DEDUPE_TTL_MS) lastPlayedAt.delete(key);
  }
}

function warnBlockedOnce(): void {
  if (warnedBlocked) return;
  warnedBlocked = true;
  // Surfaced once (not per event) so the failure is diagnosable without spam.
  console.warn(
    '[claude-alive] sound suppressed by the browser autoplay policy — it will play after the first click or keypress on the page.',
  );
}

/** Whether audio playback has been unlocked by a user gesture. */
export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

function prime(kind: SoundKind): void {
  const el = getElement(kind);
  if (!el) return;
  const restoreMuted = el.muted;
  el.muted = true;
  try {
    const p = el.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        el.pause();
        el.currentTime = 0;
        el.muted = restoreMuted;
      }).catch(() => {
        el.muted = restoreMuted;
      });
    } else {
      el.muted = restoreMuted;
    }
  } catch {
    el.muted = restoreMuted;
  }
}

/**
 * Register one-time listeners that unlock audio on the first user gesture.
 *
 * Idempotent and SSR/test-safe. Returns a cleanup function that removes the
 * listeners (also auto-removed once a gesture fires).
 */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined' || audioUnlocked) return () => {};

  const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];

  const remove = () => {
    for (const evt of events) window.removeEventListener(evt, handler);
  };

  const handler = () => {
    if (!audioUnlocked) {
      audioUnlocked = true;
      prime('completion');
      prime('error');
      prime('waiting');
    }
    remove();
  };

  for (const evt of events) window.addEventListener(evt, handler, { passive: true });
  return remove;
}

function play(kind: SoundKind, dedupeKey: string, volume: number): void {
  if (volume <= 0) return;
  const now = Date.now();
  const prev = lastPlayedAt.get(dedupeKey) ?? 0;
  if (now - prev < SOUND_DEBOUNCE_MS) return;
  lastPlayedAt.set(dedupeKey, now);
  pruneDedupe(now);

  const el = getElement(kind);
  if (!el) return;
  try {
    el.muted = false;
    el.volume = volume;
    el.currentTime = 0;
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          warnBlockedOnce();
        }
        // Other errors (decode, network) are non-actionable here — ignore.
      });
    }
  } catch {
    // Audio not supported — ignore.
  }
}

/** Play the completion chime, gated by the user's settings. */
export function playCompletionSound(sessionId = 'global'): void {
  const cfg = getSettings().sound.completion;
  if (!cfg.enabled) return;
  play('completion', `complete:${sessionId}`, cfg.volume);
}

/** Play the error tone, gated by the user's settings. */
export function playErrorSound(sessionId = 'global'): void {
  const cfg = getSettings().sound.error;
  if (!cfg.enabled) return;
  play('error', `error:${sessionId}`, cfg.volume);
}

/**
 * Play the "needs your decision" tone when an agent enters `waiting` — Claude is
 * asking the user a question, requesting permission, or waiting on plan approval.
 * Gated by the user's settings; debounced per session like the other sounds.
 */
export function playWaitingSound(sessionId = 'global'): void {
  const cfg = getSettings().sound.waiting;
  if (!cfg.enabled) return;
  play('waiting', `waiting:${sessionId}`, cfg.volume);
}

/**
 * Play the error tone for a CPU/memory resource alert. Routed through the shared
 * error element so it benefits from the same unlock and debounce as agent errors.
 * The caller (resource-alert effect) owns its own enable/threshold/cooldown gating.
 */
export function playResourceAlertSound(volume: number): void {
  play('error', 'alert:resource', volume);
}

/**
 * Reset all module-level singleton state. TEST-ONLY.
 *
 * The test harness relies on `vi.resetModules()` for a clean module per test,
 * but under shared worker pools (CI runs many files in one worker) the module
 * registry isn't always re-executed, so the cached audio `elements`, dedupe map
 * and unlock flag leak across tests — causing reused (cached) elements to be
 * invisible to a per-test-reset `created` array. Calling this from the test
 * loader makes state deterministic regardless of re-import. Never call in prod.
 */
export function __resetSoundStateForTests(): void {
  for (const k of Object.keys(elements)) delete elements[k as SoundKind];
  lastPlayedAt.clear();
  audioUnlocked = false;
  warnedBlocked = false;
}

/**
 * Play a sound immediately for the Settings "Test" buttons. Bypasses the
 * enabled toggle and debounce because it always runs inside a user-gesture
 * click handler — its purpose is to preview the chosen volume.
 */
export function playTestSound(kind: SoundKind, volume: number): void {
  const el = getElement(kind);
  if (!el) return;
  try {
    el.muted = false;
    el.volume = volume;
    el.currentTime = 0;
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // Audio not supported — ignore.
  }
}

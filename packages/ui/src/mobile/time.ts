/**
 * Absolute timestamps for the phone.
 *
 * "3시간 전" answers "is this fresh" and nothing else. On a phone the question
 * is usually "when did I last talk to this session" — which run was last night
 * and which was Tuesday — and a relative string cannot answer it. So the phone
 * prints the wall clock, in the device's own zone, in the one format that
 * sorts and compares by eye: `YYYY-MM-DD HH:mm`.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD HH:mm` in local time; empty string for a missing timestamp. */
export function formatStamp(ms: number | undefined | null): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `HH:mm` when the timestamp is today, the full stamp otherwise. */
export function formatStampShort(ms: number | undefined | null, now: number = Date.now()): string {
  const full = formatStamp(ms);
  if (!full) return '';
  const d = new Date(ms as number);
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay ? full.slice(11) : full;
}

/**
 * Coarse age for a timestamp: seconds under a minute, then minutes, hours, days.
 *
 * Deliberately unit-suffixed rather than translated prose — the sidebar packs
 * one of these onto every row, and a full "3 minutes ago" would not fit beside
 * a branch name. The surrounding i18n string supplies the "ago".
 */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

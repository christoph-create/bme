const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Formats an elapsed duration (ms) as a short relative-time string, e.g. "12s ago". */
export function formatTimeAgo(deltaMs: number): string {
  if (deltaMs < 5 * SECOND) {
    return "just now";
  }
  if (deltaMs < MINUTE) {
    return `${Math.floor(deltaMs / SECOND)}s ago`;
  }
  if (deltaMs < HOUR) {
    return `${Math.floor(deltaMs / MINUTE)}m ago`;
  }
  if (deltaMs < DAY) {
    return `${Math.floor(deltaMs / HOUR)}h ago`;
  }
  return `${Math.floor(deltaMs / DAY)}d ago`;
}

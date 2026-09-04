function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Formats a receive timestamp as a wall-clock label, e.g. "14:32:07" for
 * today or "Sep 3, 14:32:07" for a message received on an earlier day. */
export function formatClockTime(timestampMs: number, nowMs: number): string {
  const ts = new Date(timestampMs);
  const time = ts.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  if (isSameDay(ts, new Date(nowMs))) {
    return time;
  }
  const date = ts.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${date}, ${time}`;
}

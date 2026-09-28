/**
 * How the broker panel renders a number.
 *
 * Next to the panel rather than in `core/`, the same way `axis-format.ts`
 * sits with the charts: nothing else in the app shows a byte total or a rate,
 * and a shared formatter would only invite a second set of rounding rules.
 *
 * Every tile goes through here, so this is the one place the rounding is
 * decided - and its spec is where those decisions are written down.
 */

/** What a tile shows when there is nothing to show. An em dash, not "0":
 * a rate nobody has measured yet is not a rate of zero. */
export const NO_VALUE = "—";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Bytes at three significant figures, in whichever unit keeps it readable.
 *
 * Decimal units (1000, not 1024): these are counted off the wire, and every
 * broker and packet capture the number will be compared against uses
 * decimal too.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return NO_VALUE;
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // Bytes are whole things; anything above them gets one decimal until it is
  // big enough not to need one.
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** A count with thousands separators, so five figures can be read at a
 * glance rather than counted. */
export function formatCount(count: number): string {
  if (!Number.isFinite(count)) {
    return NO_VALUE;
  }
  return Math.round(count).toLocaleString("en-US");
}

/**
 * A duration as its two largest units - `3d 4h`, `4h 12m`, `2m 08s`, `48s`.
 *
 * Two units rather than one because the second is what makes it a reading
 * you can watch change, and rather than three because nobody needs the
 * seconds of a four-day uptime.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return NO_VALUE;
  }
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/**
 * A per-second rate.
 *
 * One decimal below ten, because the interesting part of a slow feed is
 * whether it is 0.4/s or 4/s; none above, because at that point the decimal
 * is just noise that changes every tick.
 */
export function formatRate(perSecond: number | null): string {
  if (perSecond === null || !Number.isFinite(perSecond) || perSecond < 0) {
    return NO_VALUE;
  }
  if (perSecond === 0) {
    return "0/s";
  }
  // Anything real but too small to show as 0.1 would otherwise round to
  // "0/s", which reads as "stopped" when it is not.
  if (perSecond < 0.05) {
    return "<0.1/s";
  }
  return perSecond < 10
    ? `${perSecond.toFixed(1)}/s`
    : `${Math.round(perSecond).toLocaleString("en-US")}/s`;
}

/** A per-second byte rate, sharing {@link formatBytes}' units. */
export function formatByteRate(bytesPerSecond: number | null): string {
  if (
    bytesPerSecond === null ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond < 0
  ) {
    return NO_VALUE;
  }
  return `${formatBytes(bytesPerSecond)}/s`;
}

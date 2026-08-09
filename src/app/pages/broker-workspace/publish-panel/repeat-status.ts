/**
 * Labels for the repeat run, kept out of the panel so the wording is testable
 * on its own - same treatment as `format/reconnect-label.ts`.
 */

export const MIN_INTERVAL_MS = 10;
export const MAX_INTERVAL_MS = 3_600_000;
export const MIN_REPEAT_COUNT = 1;
export const MAX_REPEAT_COUNT = 1_000_000;

/** Keeps a hand-typed interval inside what a browser timer and a broker can
 * actually honour, rather than trusting the number input's `min`/`max`. */
export function clampInterval(ms: number): number {
  if (!Number.isFinite(ms)) {
    return MIN_INTERVAL_MS;
  }
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(ms)));
}

export function clampCount(count: number): number {
  if (!Number.isFinite(count)) {
    return MIN_REPEAT_COUNT;
  }
  return Math.min(MAX_REPEAT_COUNT, Math.max(MIN_REPEAT_COUNT, Math.round(count)));
}

/** Milliseconds below a second, seconds above - "every 1500 ms" reads worse
 * than "every 1.5s" once the interval is something a human chose. */
export function formatInterval(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

/** The always-visible chip on the main layer: what the settings layer is
 * currently configured to do, without having to open it. */
export function repeatSummaryLabel(
  intervalMs: number,
  count: number | null,
): string {
  return `every ${formatInterval(intervalMs)} × ${count ?? "∞"}`;
}

/** The header line while a run is live. `null` when there's nothing to say,
 * so the caller can fall back to the ordinary published flash. */
export function repeatProgressLabel(
  running: boolean,
  sent: number,
  count: number | null,
): string | null {
  if (!running) {
    return null;
  }
  const progress = count === null ? `${sent} sent` : `${sent} of ${count} sent`;
  return `Repeating · ${progress}`;
}

/** Why a run ended early. Always names the count, because "how far did it get
 * before it broke" is the first thing you want to know. */
export function repeatStoppedMessage(sent: number, error: string): string {
  const messages = sent === 1 ? "1 message" : `${sent} messages`;
  return `Repeat stopped after ${messages}: ${error}`;
}

/** Confirmation for a run that reached its configured count. */
export function repeatFinishedLabel(sent: number): string {
  return sent === 1 ? "✓ Sent 1 message" : `✓ Sent ${sent} messages`;
}

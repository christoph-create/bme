import { decimalsForStep } from "./axis-ticks";

/** Below this span, ticks are close enough together that minutes alone
 * wouldn't tell them apart. */
const SECONDS_VISIBLE_BELOW_MS = 90_000;

const EXPONENTIAL_ABOVE = 1e6;
const EXPONENTIAL_BELOW = 1e-4;
const MAX_SIGNIFICANT_DECIMALS = 4;

/**
 * Formats a value-axis tick at the precision its `step` implies, so a 0.5
 * step reads "23.5" rather than "23.500000000000004".
 */
export function formatAxisValue(value: number, step: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  if (isExtreme(value)) {
    return value.toExponential(1);
  }
  return value.toFixed(decimalsForStep(step));
}

/**
 * Wall-clock label for a time-axis tick, 24-hour and zero-padded.
 *
 * Absolute rather than relative ("2m ago") on purpose: nothing re-renders
 * once messages stop arriving, and a relative label would then quietly
 * misreport how old the data is. A clock time is never wrong, only stale.
 */
export function formatClockTime(timestamp: number, spanMs: number): string {
  const date = new Date(timestamp);
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  if (spanMs >= SECONDS_VISIBLE_BELOW_MS) {
    return `${hours}:${minutes}`;
  }
  return `${hours}:${minutes}:${pad(date.getSeconds())}`;
}

/**
 * The card's headline reading. Unlike an axis tick this has no step to take
 * its precision from, so it keeps whatever the value actually carries, up to
 * a readable limit.
 */
export function formatSampleValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (isExtreme(value)) {
    return value.toExponential(2);
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(MAX_SIGNIFICANT_DECIMALS)));
}

function isExtreme(value: number): boolean {
  const magnitude = Math.abs(value);
  return (
    magnitude >= EXPONENTIAL_ABOVE || (magnitude > 0 && magnitude < EXPONENTIAL_BELOW)
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

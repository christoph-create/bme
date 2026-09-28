/**
 * A rolling one-minute view of how fast messages are arriving.
 *
 * A fixed ring of per-second buckets rather than a list of timestamps: the
 * list is unbounded at a few thousand messages a second, and this is not.
 * Buckets are addressed by `second % RATE_WINDOW_SECONDS` and carry the
 * second they describe, so a stale one is recognised on read and counted as
 * zero - a connection that goes quiet decays to nothing with no timer
 * anywhere.
 *
 * Nothing in here reads the clock. Every function takes `nowMs`, the same way
 * `computeChartGeometry` takes its size, which is the whole reason this is
 * testable without faking time.
 */
export const RATE_WINDOW_SECONDS = 60;

interface RateBucket {
  /** The epoch second this bucket counts, or -Infinity when it has never
   * been written. A sentinel outside the number line of real seconds, so it
   * cannot collide with one. */
  readonly second: number;
  readonly messages: number;
  readonly bytes: number;
}

export interface RateWindow {
  readonly startedSecond: number;
  readonly buckets: readonly RateBucket[];
}

export interface RateReading {
  readonly messagesPerSecond: number;
  readonly bytesPerSecond: number;
  /** One count per second, oldest first, for a sparkline. Always
   * `RATE_WINDOW_SECONDS` long, zero-filled where nothing arrived. */
  readonly series: readonly number[];
}

const EMPTY_BUCKET: RateBucket = {
  second: Number.NEGATIVE_INFINITY,
  messages: 0,
  bytes: 0,
};

function secondOf(nowMs: number): number {
  return Math.floor(nowMs / 1000);
}

/** Non-negative modulo - `%` keeps the sign of its left operand, and the
 * seconds walked in `readRateWindow` go negative near the epoch. */
function indexOf(second: number): number {
  return (
    ((second % RATE_WINDOW_SECONDS) + RATE_WINDOW_SECONDS) % RATE_WINDOW_SECONDS
  );
}

export function createRateWindow(nowMs: number): RateWindow {
  return {
    startedSecond: secondOf(nowMs),
    buckets: new Array<RateBucket>(RATE_WINDOW_SECONDS).fill(EMPTY_BUCKET),
  };
}

export function recordInWindow(
  window: RateWindow,
  nowMs: number,
  bytes: number,
): RateWindow {
  const second = secondOf(nowMs);
  const index = indexOf(second);
  const existing = window.buckets[index];
  // A bucket whose second doesn't match is a lap old, so it is replaced
  // rather than added to. That is how the ring forgets.
  const bucket: RateBucket =
    existing.second === second
      ? {
          second,
          messages: existing.messages + 1,
          bytes: existing.bytes + bytes,
        }
      : { second, messages: 1, bytes };

  const buckets = [...window.buckets];
  buckets[index] = bucket;
  return { ...window, buckets };
}

/**
 * The rate over the last `RATE_WINDOW_SECONDS` *complete* seconds.
 *
 * The second in progress is left out of both the total and the divisor:
 * counting a second we are 200ms into would report a fifth of the real rate
 * and make the number flicker once a second for no reason.
 *
 * The divisor is how long this window has actually been running, capped at
 * its length - dividing the first ten seconds of a session by sixty would
 * understate it six-fold.
 */
export function readRateWindow(window: RateWindow, nowMs: number): RateReading {
  const nowSecond = secondOf(nowMs);
  const newest = nowSecond - 1;
  const oldest = newest - RATE_WINDOW_SECONDS + 1;

  let messages = 0;
  let bytes = 0;
  const series: number[] = [];

  for (let second = oldest; second <= newest; second++) {
    const bucket = window.buckets[indexOf(second)];
    const live = bucket.second === second;
    series.push(live ? bucket.messages : 0);
    if (live) {
      messages += bucket.messages;
      bytes += bucket.bytes;
    }
  }

  const elapsed = Math.max(
    1,
    Math.min(RATE_WINDOW_SECONDS, nowSecond - window.startedSecond),
  );

  return {
    messagesPerSecond: messages / elapsed,
    bytesPerSecond: bytes / elapsed,
    series,
  };
}

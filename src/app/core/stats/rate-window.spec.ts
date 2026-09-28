import { describe, expect, it } from "vitest";

import {
  RATE_WINDOW_SECONDS,
  RateWindow,
  createRateWindow,
  readRateWindow,
  recordInWindow,
} from "./rate-window";

const START = 1_700_000_000_000;
const SECOND = 1000;

/** `count` messages of `bytes` each, all landing in the second at `atMs`. */
function record(
  window: RateWindow,
  atMs: number,
  count: number,
  bytes = 10,
): RateWindow {
  let next = window;
  for (let i = 0; i < count; i++) {
    next = recordInWindow(next, atMs, bytes);
  }
  return next;
}

describe("readRateWindow", () => {
  it("reports nothing before a single second has completed", () => {
    const window = record(createRateWindow(START), START, 5);

    expect(readRateWindow(window, START + 500).messagesPerSecond).toBe(0);
  });

  /** The divisor is how long the window has run, not its length - dividing
   * the first ten seconds of a session by sixty understates it six-fold. */
  it("divides a partly-filled window by its real span", () => {
    let window = createRateWindow(START);
    for (let i = 0; i < 10; i++) {
      window = record(window, START + i * SECOND, 4);
    }

    const reading = readRateWindow(window, START + 10 * SECOND);

    expect(reading.messagesPerSecond).toBe(4);
    expect(reading.bytesPerSecond).toBe(40);
  });

  /** The second in progress is excluded from both sides, or a reading taken
   * 200ms into it would report a fifth of the truth. */
  it("ignores the second still filling", () => {
    let window = record(createRateWindow(START), START, 2);
    window = record(window, START + SECOND, 100);

    const reading = readRateWindow(window, START + SECOND + 200);

    expect(reading.messagesPerSecond).toBe(2);
  });

  it("rolls buckets out once they leave the window", () => {
    let window = record(createRateWindow(START), START, 60);
    // One message a second for a full lap, so the burst above is lapped.
    for (let i = 1; i <= RATE_WINDOW_SECONDS; i++) {
      window = record(window, START + i * SECOND, 1);
    }

    const reading = readRateWindow(
      window,
      START + (RATE_WINDOW_SECONDS + 1) * SECOND,
    );

    expect(reading.messagesPerSecond).toBe(1);
  });

  /** A silent connection has to decay to zero on its own - nothing ticks the
   * window, so the read is the only chance to notice. */
  it("empties after a gap longer than the window, rather than wrapping", () => {
    const window = record(createRateWindow(START), START, 30);

    const reading = readRateWindow(window, START + 10 * 60 * SECOND);

    expect(reading.messagesPerSecond).toBe(0);
    expect(reading.bytesPerSecond).toBe(0);
    expect(reading.series.every((count) => count === 0)).toBe(true);
  });

  it("is idempotent - reading does not consume", () => {
    const window = record(createRateWindow(START), START, 3);

    const first = readRateWindow(window, START + 2 * SECOND);
    const second = readRateWindow(window, START + 2 * SECOND);

    expect(second).toEqual(first);
  });

  it("returns a full-length series, oldest first", () => {
    let window = createRateWindow(START);
    window = record(window, START, 1);
    window = record(window, START + SECOND, 2);

    const { series } = readRateWindow(window, START + 2 * SECOND);

    expect(series).toHaveLength(RATE_WINDOW_SECONDS);
    expect(series.slice(-2)).toEqual([1, 2]);
    expect(series.slice(0, -2).every((count) => count === 0)).toBe(true);
  });
});

describe("recordInWindow", () => {
  it("leaves the window it was given alone", () => {
    const window = createRateWindow(START);

    const next = recordInWindow(window, START, 10);

    expect(next).not.toBe(window);
    expect(readRateWindow(window, START + 2 * SECOND).messagesPerSecond).toBe(
      0,
    );
  });

  it("sums bytes within a second", () => {
    let window = createRateWindow(START);
    window = recordInWindow(window, START, 100);
    window = recordInWindow(window, START + 400, 250);

    expect(readRateWindow(window, START + SECOND).bytesPerSecond).toBe(350);
  });
});

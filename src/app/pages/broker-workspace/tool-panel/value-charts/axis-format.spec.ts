import { describe, expect, it } from "vitest";

import {
  formatAxisValue,
  formatClockTime,
  formatSampleValue,
} from "./axis-format";

/** Built from local-time parts on purpose: `getHours()` is timezone-dependent,
 * so an epoch literal here would pass locally and fail in CI. */
function at(hours: number, minutes: number, seconds: number): number {
  return new Date(2024, 0, 1, hours, minutes, seconds).getTime();
}

describe("formatAxisValue", () => {
  it("prints no decimals for an integer step", () => {
    expect(formatAxisValue(40, 20)).toBe("40");
  });

  it("prints one decimal for a half step", () => {
    expect(formatAxisValue(23.5, 0.5)).toBe("23.5");
  });

  it("prints the step's precision even when the value is round", () => {
    expect(formatAxisValue(23, 0.01)).toBe("23.00");
  });

  it("keeps negative values signed", () => {
    expect(formatAxisValue(-12.5, 0.5)).toBe("-12.5");
  });

  it("prints zero at the step's precision", () => {
    expect(formatAxisValue(0, 0.5)).toBe("0.0");
  });

  it("falls back to exponential for very large and very small values", () => {
    expect(formatAxisValue(1e7, 1e6)).toBe("1.0e+7");
    expect(formatAxisValue(1e-6, 1e-7)).toBe("1.0e-6");
  });
});

describe("formatClockTime", () => {
  it("includes seconds for a short span", () => {
    expect(formatClockTime(at(12, 4, 32), 30_000)).toBe("12:04:32");
  });

  it("drops seconds once the span is long enough for minutes to separate ticks", () => {
    expect(formatClockTime(at(12, 4, 32), 600_000)).toBe("12:04");
  });

  it("switches at 90 seconds", () => {
    expect(formatClockTime(at(9, 0, 5), 89_999)).toBe("09:00:05");
    expect(formatClockTime(at(9, 0, 5), 90_000)).toBe("09:00");
  });

  it("zero-pads and uses a 24-hour clock", () => {
    expect(formatClockTime(at(0, 7, 3), 1000)).toBe("00:07:03");
    expect(formatClockTime(at(23, 59, 59), 1000)).toBe("23:59:59");
  });
});

describe("formatSampleValue", () => {
  it("prints an integer without a decimal point", () => {
    expect(formatSampleValue(42)).toBe("42");
  });

  it("keeps the precision the value actually carries", () => {
    expect(formatSampleValue(23.5)).toBe("23.5");
    expect(formatSampleValue(0.125)).toBe("0.125");
  });

  it("trims runaway precision", () => {
    expect(formatSampleValue(1 / 3)).toBe("0.3333");
  });

  it("falls back to exponential at the extremes", () => {
    expect(formatSampleValue(1.5e9)).toBe("1.50e+9");
    expect(formatSampleValue(2e-7)).toBe("2.00e-7");
  });

  it("shows a dash rather than NaN", () => {
    expect(formatSampleValue(Number.NaN)).toBe("—");
  });
});

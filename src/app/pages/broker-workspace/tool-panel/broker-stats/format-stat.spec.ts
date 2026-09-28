import { describe, expect, it } from "vitest";

import {
  NO_VALUE,
  formatByteRate,
  formatBytes,
  formatCount,
  formatDuration,
  formatRate,
} from "./format-stat";

describe("formatBytes", () => {
  it("counts plain bytes whole", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  /** Decimal units, because every broker and packet capture this will be
   * compared against uses them too. */
  it("steps up at a thousand, not at 1024", () => {
    expect(formatBytes(1000)).toBe("1.0 KB");
    expect(formatBytes(1023)).toBe("1.0 KB");
    expect(formatBytes(1_200_000)).toBe("1.2 MB");
  });

  it("drops the decimal once the number is big enough to carry itself", () => {
    expect(formatBytes(12_400)).toBe("12 KB");
    expect(formatBytes(412_000)).toBe("412 KB");
  });

  it("goes all the way up without running out of units", () => {
    expect(formatBytes(3.4e12)).toBe("3.4 TB");
    expect(formatBytes(9e18)).toBe("9000000 TB");
  });

  it("refuses to render nonsense", () => {
    expect(formatBytes(-1)).toBe(NO_VALUE);
    expect(formatBytes(Number.NaN)).toBe(NO_VALUE);
  });
});

describe("formatCount", () => {
  it("separates thousands", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(12_481)).toBe("12,481");
  });

  it("refuses to render nonsense", () => {
    expect(formatCount(Number.NaN)).toBe(NO_VALUE);
  });
});

describe("formatDuration", () => {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("shows seconds alone below a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(48 * SECOND)).toBe("48s");
    expect(formatDuration(59 * SECOND + 999)).toBe("59s");
  });

  /** Zero-padded, so the reading doesn't jump a character wide every ten
   * seconds while you are watching it. */
  it("pads the smaller unit", () => {
    expect(formatDuration(2 * MINUTE + 8 * SECOND)).toBe("2m 08s");
    expect(formatDuration(4 * HOUR + 2 * MINUTE)).toBe("4h 02m");
  });

  it("stops at two units", () => {
    expect(formatDuration(12 * MINUTE + 4 * SECOND)).toBe("12m 04s");
    expect(formatDuration(4 * HOUR + 12 * MINUTE + 30 * SECOND)).toBe("4h 12m");
    expect(formatDuration(3 * DAY + 4 * HOUR + 20 * MINUTE)).toBe("3d 4h");
  });

  it("refuses to render nonsense", () => {
    expect(formatDuration(-1)).toBe(NO_VALUE);
    expect(formatDuration(Number.NaN)).toBe(NO_VALUE);
  });
});

describe("formatRate", () => {
  it("keeps a decimal while the decimal is the interesting part", () => {
    expect(formatRate(4.34)).toBe("4.3/s");
    expect(formatRate(0.4)).toBe("0.4/s");
  });

  it("drops it once it is just noise", () => {
    expect(formatRate(12.4)).toBe("12/s");
    expect(formatRate(4821.6)).toBe("4,822/s");
  });

  /** "0/s" reads as stopped. Something arriving once a minute is not. */
  it("tells a trickle apart from a stop", () => {
    expect(formatRate(0)).toBe("0/s");
    expect(formatRate(0.016)).toBe("<0.1/s");
  });

  it("has nothing to say when there is no reading", () => {
    expect(formatRate(null)).toBe(NO_VALUE);
    expect(formatRate(Number.NaN)).toBe(NO_VALUE);
  });
});

describe("formatByteRate", () => {
  it("borrows the byte units", () => {
    expect(formatByteRate(3100)).toBe("3.1 KB/s");
    expect(formatByteRate(0)).toBe("0 B/s");
  });

  it("has nothing to say when there is no reading", () => {
    expect(formatByteRate(null)).toBe(NO_VALUE);
  });
});

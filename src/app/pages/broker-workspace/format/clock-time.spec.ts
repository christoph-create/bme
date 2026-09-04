import { describe, expect, it } from "vitest";

import { formatClockTime } from "./clock-time";

describe("formatClockTime", () => {
  it("omits the date when the message arrived earlier the same day", () => {
    const now = new Date(2026, 8, 4, 18, 0, 0).getTime();
    const receivedAt = new Date(2026, 8, 4, 14, 32, 7).getTime();
    expect(formatClockTime(receivedAt, now)).not.toMatch(/\d{1,2}\/|Sep/);
  });

  it("prefixes the date when the message arrived on an earlier day", () => {
    const now = new Date(2026, 8, 4, 9, 0, 0).getTime();
    const receivedAt = new Date(2026, 8, 3, 14, 32, 7).getTime();
    expect(formatClockTime(receivedAt, now)).toMatch(/^Sep 3,/);
  });
});

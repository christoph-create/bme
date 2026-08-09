import { describe, expect, it } from "vitest";

import {
  MAX_INTERVAL_MS,
  MAX_REPEAT_COUNT,
  MIN_INTERVAL_MS,
  MIN_REPEAT_COUNT,
  clampCount,
  clampInterval,
  formatInterval,
  repeatFinishedLabel,
  repeatProgressLabel,
  repeatStoppedMessage,
  repeatSummaryLabel,
} from "./repeat-status";

describe("clampInterval", () => {
  it("passes an ordinary interval through", () => {
    expect(clampInterval(500)).toBe(500);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clampInterval(0)).toBe(MIN_INTERVAL_MS);
    expect(clampInterval(-100)).toBe(MIN_INTERVAL_MS);
    expect(clampInterval(MAX_INTERVAL_MS + 1)).toBe(MAX_INTERVAL_MS);
  });

  it("rounds a fractional interval", () => {
    expect(clampInterval(500.6)).toBe(501);
  });

  it("falls back to the minimum for a blank or unparseable input", () => {
    expect(clampInterval(NaN)).toBe(MIN_INTERVAL_MS);
    expect(clampInterval(Infinity)).toBe(MIN_INTERVAL_MS);
  });
});

describe("clampCount", () => {
  it("passes an ordinary count through", () => {
    expect(clampCount(10)).toBe(10);
  });

  it("never allows a run of zero messages", () => {
    expect(clampCount(0)).toBe(MIN_REPEAT_COUNT);
    expect(clampCount(-5)).toBe(MIN_REPEAT_COUNT);
  });

  it("caps at the maximum", () => {
    expect(clampCount(MAX_REPEAT_COUNT + 1)).toBe(MAX_REPEAT_COUNT);
  });

  it("falls back to the minimum for a blank input", () => {
    expect(clampCount(NaN)).toBe(MIN_REPEAT_COUNT);
  });
});

describe("formatInterval", () => {
  it("uses milliseconds below a second", () => {
    expect(formatInterval(10)).toBe("10 ms");
    expect(formatInterval(500)).toBe("500 ms");
    expect(formatInterval(999)).toBe("999 ms");
  });

  it("switches to whole seconds at a second", () => {
    expect(formatInterval(1000)).toBe("1s");
    expect(formatInterval(60_000)).toBe("60s");
  });

  it("shows one decimal for a fractional number of seconds", () => {
    expect(formatInterval(1500)).toBe("1.5s");
    expect(formatInterval(2250)).toBe("2.3s");
  });
});

describe("repeatSummaryLabel", () => {
  it("shows the interval and a finite count", () => {
    expect(repeatSummaryLabel(500, 10)).toBe("every 500 ms × 10");
  });

  it("shows infinity for an unbounded run", () => {
    expect(repeatSummaryLabel(1000, null)).toBe("every 1s × ∞");
  });
});

describe("repeatProgressLabel", () => {
  it("says nothing when no run is live", () => {
    expect(repeatProgressLabel(false, 37, null)).toBeNull();
  });

  it("counts up without a target for an unbounded run", () => {
    expect(repeatProgressLabel(true, 37, null)).toBe("Repeating · 37 sent");
  });

  it("shows progress against the target for a bounded run", () => {
    expect(repeatProgressLabel(true, 3, 10)).toBe("Repeating · 3 of 10 sent");
  });

  it("reads sensibly before the first message lands", () => {
    expect(repeatProgressLabel(true, 0, 5)).toBe("Repeating · 0 of 5 sent");
  });
});

describe("repeatStoppedMessage", () => {
  it("names how far the run got and why it stopped", () => {
    expect(repeatStoppedMessage(37, "Not connected to the broker")).toBe(
      "Repeat stopped after 37 messages: Not connected to the broker",
    );
  });

  it("singularises a single message", () => {
    expect(repeatStoppedMessage(1, "boom")).toBe(
      "Repeat stopped after 1 message: boom",
    );
  });

  it("handles failing on the very first send", () => {
    expect(repeatStoppedMessage(0, "boom")).toBe(
      "Repeat stopped after 0 messages: boom",
    );
  });
});

describe("repeatFinishedLabel", () => {
  it("confirms a completed run", () => {
    expect(repeatFinishedLabel(10)).toBe("✓ Sent 10 messages");
  });

  it("singularises a single message", () => {
    expect(repeatFinishedLabel(1)).toBe("✓ Sent 1 message");
  });
});

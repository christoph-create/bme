import { describe, expect, it } from "vitest";

import { formatTimeAgo } from "./time-ago";

describe("formatTimeAgo", () => {
  it("returns 'just now' for anything under 5 seconds", () => {
    expect(formatTimeAgo(0)).toBe("just now");
    expect(formatTimeAgo(4999)).toBe("just now");
  });

  it("formats seconds", () => {
    expect(formatTimeAgo(5000)).toBe("5s ago");
    expect(formatTimeAgo(45_000)).toBe("45s ago");
    expect(formatTimeAgo(59_999)).toBe("59s ago");
  });

  it("formats minutes", () => {
    expect(formatTimeAgo(60_000)).toBe("1m ago");
    expect(formatTimeAgo(59 * 60_000)).toBe("59m ago");
  });

  it("formats hours", () => {
    expect(formatTimeAgo(60 * 60_000)).toBe("1h ago");
    expect(formatTimeAgo(23 * 60 * 60_000)).toBe("23h ago");
  });

  it("formats days", () => {
    expect(formatTimeAgo(24 * 60 * 60_000)).toBe("1d ago");
    expect(formatTimeAgo(3 * 24 * 60 * 60_000)).toBe("3d ago");
  });
});

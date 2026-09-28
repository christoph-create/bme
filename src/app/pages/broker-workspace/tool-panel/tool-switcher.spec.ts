import { describe, expect, it } from "vitest";

import { nextTool, stepForKey } from "./tool-switcher";

const TOOLS: readonly string[] = ["charts", "broker", "pin"];

describe("stepForKey", () => {
  it("reads both axes, so the strip works however it is laid out", () => {
    expect(stepForKey("ArrowLeft")).toBe(-1);
    expect(stepForKey("ArrowUp")).toBe(-1);
    expect(stepForKey("ArrowRight")).toBe(1);
    expect(stepForKey("ArrowDown")).toBe(1);
  });

  it("jumps to the ends", () => {
    expect(stepForKey("Home")).toBe("first");
    expect(stepForKey("End")).toBe("last");
  });

  /** Swallowing keys the strip has no opinion about would break Tab. */
  it("has no opinion about anything else", () => {
    expect(stepForKey("Tab")).toBeNull();
    expect(stepForKey("a")).toBeNull();
    expect(stepForKey("Enter")).toBeNull();
  });
});

describe("nextTool", () => {
  it("steps forward and back", () => {
    expect(nextTool(TOOLS, "charts", 1)).toBe("broker");
    expect(nextTool(TOOLS, "broker", -1)).toBe("charts");
  });

  it("wraps at both ends", () => {
    expect(nextTool(TOOLS, "pin", 1)).toBe("charts");
    expect(nextTool(TOOLS, "charts", -1)).toBe("pin");
  });

  it("jumps to the first and last", () => {
    expect(nextTool(TOOLS, "broker", "first")).toBe("charts");
    expect(nextTool(TOOLS, "broker", "last")).toBe("pin");
  });

  it("stays put when there is nowhere to go", () => {
    expect(nextTool(["charts"], "charts", 1)).toBe("charts");
    expect(nextTool(["charts"], "charts", -1)).toBe("charts");
    expect(nextTool([], "charts", 1)).toBe("charts");
  });

  /** A stale id starts over rather than leaving nothing selected. */
  it("falls back to the first tool for an id it doesn't know", () => {
    expect(nextTool(TOOLS, "gone", 1)).toBe("charts");
    expect(nextTool(TOOLS, "gone", -1)).toBe("charts");
  });
});

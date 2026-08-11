import { describe, expect, it } from "vitest";

import { nextActiveId } from "./next-active-tab";

const OPEN = ["a", "b", "c"];

describe("nextActiveId", () => {
  it("moves to the tab on the right", () => {
    expect(nextActiveId(OPEN, "b", "b")).toBe("c");
  });

  it("falls back to the tab on the left when there is nothing to the right", () => {
    expect(nextActiveId(OPEN, "c", "c")).toBe("b");
  });

  it("leaves nothing active when the last tab closes", () => {
    expect(nextActiveId(["a"], "a", "a")).toBeNull();
  });

  it("leaves the active tab alone when a different one closes", () => {
    expect(nextActiveId(OPEN, "a", "c")).toBe("c");
  });

  it("changes nothing for an id that was never open", () => {
    expect(nextActiveId(OPEN, "zzz", "b")).toBe("b");
  });

  it("stays put when nothing was active", () => {
    expect(nextActiveId(OPEN, "b", null)).toBeNull();
  });
});

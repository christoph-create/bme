import { describe, expect, it } from "vitest";

import { computeOffsets, computeVisibleRange } from "./virtual-range";

describe("computeOffsets", () => {
  it("returns a single zero for an empty stack", () => {
    expect(computeOffsets([], 8)).toEqual([0]);
  });

  it("stacks items with a gap between them but not after the last one", () => {
    expect(computeOffsets([10, 20, 30], 5)).toEqual([0, 15, 40, 70]);
  });

  it("applies the same gap before the first item as between later ones", () => {
    const offsets = computeOffsets([10, 10, 10], 5);
    const firstGap = offsets[1] - (offsets[0] + 10);
    const secondGap = offsets[2] - (offsets[1] + 10);
    expect(firstGap).toBe(5);
    expect(firstGap).toBe(secondGap);
  });

  it("ignores gap entirely for a single item", () => {
    expect(computeOffsets([42], 8)).toEqual([0, 42]);
  });
});

describe("computeVisibleRange", () => {
  const offsets = computeOffsets([10, 10, 10, 10, 10], 0); // [0,10,20,30,40,50]

  it("returns an empty range when there are no items", () => {
    expect(computeVisibleRange([0], 0, 100, 0)).toEqual({
      startIndex: 0,
      endIndex: 0,
    });
  });

  it("covers exactly the items overlapping the viewport, with no buffer", () => {
    // viewport [22, 37) overlaps items 2 (20-30) and 3 (30-40)
    expect(computeVisibleRange(offsets, 22, 15, 0)).toEqual({
      startIndex: 2,
      endIndex: 4,
    });
  });

  it("expands the range by the buffer on each side", () => {
    expect(computeVisibleRange(offsets, 22, 15, 1)).toEqual({
      startIndex: 1,
      endIndex: 5,
    });
  });

  it("clamps the start of the range at 0", () => {
    expect(computeVisibleRange(offsets, 0, 5, 10)).toEqual({
      startIndex: 0,
      endIndex: 5,
    });
  });

  it("clamps the end of the range at the item count", () => {
    expect(computeVisibleRange(offsets, 45, 5, 10)).toEqual({
      startIndex: 0,
      endIndex: 5,
    });
  });

  it("returns an empty-ish range scrolled past the end of the content", () => {
    const range = computeVisibleRange(offsets, 1000, 100, 0);
    expect(range.startIndex).toBe(5);
    expect(range.endIndex).toBe(5);
  });

  it("includes an item whose top exactly matches scrollTop", () => {
    expect(computeVisibleRange(offsets, 30, 1, 0)).toEqual({
      startIndex: 3,
      endIndex: 4,
    });
  });
});

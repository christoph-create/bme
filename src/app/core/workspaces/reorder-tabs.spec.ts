import { describe, expect, it } from "vitest";

import { Slot, dragLayout, dropIndexFor, moveTab } from "./reorder-tabs";

// Four 100px-wide tabs starting at x=0, so the centres fall on the fifties.
const CENTERS: Slot[] = [0, 100, 200, 300].map((left) => ({
  left,
  width: 100,
}));

/**
 * A narrow tab beside a wide one, which is what broker names actually produce
 * and where a centre-against-centre rule comes apart.
 */
const UNEVEN: Slot[] = [
  { left: 0, width: 80 },
  { left: 80, width: 160 },
];

describe("dropIndexFor", () => {
  it("keeps a tab where it is while the pointer stays in its own slot", () => {
    expect(dropIndexFor(CENTERS, 110, 1)).toBe(1);
    expect(dropIndexFor(CENTERS, 190, 1)).toBe(1);
  });

  it("moves a tab once it passes its neighbour's centre", () => {
    expect(dropIndexFor(CENTERS, 260, 1)).toBe(2);
    expect(dropIndexFor(CENTERS, 40, 1)).toBe(0);
  });

  it("lands in the right slot when the pointer jumps several tabs at once", () => {
    expect(dropIndexFor(CENTERS, 360, 0)).toBe(3);
    expect(dropIndexFor(CENTERS, 10, 3)).toBe(0);
  });

  it("clamps to the ends rather than running off them", () => {
    expect(dropIndexFor(CENTERS, 9999, 0)).toBe(3);
    expect(dropIndexFor(CENTERS, -9999, 3)).toBe(0);
  });

  it("swaps a wide tab past a narrow one on its leading edge", () => {
    // The wide tab's own centre never reaches the narrow tab's - the strip
    // ends first - so only its left edge can decide. Its slot centre is 160;
    // the narrow tab's is 40, and its left edge crosses that at 120.
    expect(dropIndexFor(UNEVEN, 121, 1)).toBe(1);
    expect(dropIndexFor(UNEVEN, 119, 1)).toBe(0);
  });

  it("lets either tab of an uneven pair reach either end", () => {
    // Dragged as far as the strip allows, whichever one is moving.
    expect(dropIndexFor(UNEVEN, 80, 1)).toBe(0);
    expect(dropIndexFor(UNEVEN, 200, 0)).toBe(1);
  });

  it("has nowhere to move a lone tab", () => {
    expect(dropIndexFor([{ left: 0, width: 100 }], 9999, 0)).toBe(0);
  });
});

describe("moveTab", () => {
  it("moves a tab to the right", () => {
    expect(moveTab(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("moves a tab to the left", () => {
    expect(moveTab(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("returns the same array when the move changes nothing", () => {
    const ids = ["a", "b", "c"];

    expect(moveTab(ids, 1, 1)).toBe(ids);
  });

  it("returns the same array for an index it cannot honour", () => {
    const ids = ["a", "b", "c"];

    expect(moveTab(ids, -1, 1)).toBe(ids);
    expect(moveTab(ids, 1, 3)).toBe(ids);
  });
});

// Three 100px tabs, the run starting at x=0, so the centres land on the fifties.
const SLOTS: Slot[] = [
  { left: 0, width: 100 },
  { left: 100, width: 100 },
  { left: 200, width: 100 },
];

describe("dragLayout", () => {
  it("carries the tab under the pointer without changing its slot", () => {
    expect(dragLayout(SLOTS, 80, 0)).toEqual({ toIndex: 0, offset: 30 });
  });

  it("keeps carrying it once the slot beneath it has changed", () => {
    expect(dragLayout(SLOTS, 160, 0)).toEqual({ toIndex: 1, offset: 10 });
  });

  it("stops the tab at the end of the run rather than past it", () => {
    expect(dragLayout(SLOTS, 10_000, 0)).toEqual({ toIndex: 2, offset: 0 });
    expect(dragLayout(SLOTS, -10_000, 2)).toEqual({ toIndex: 0, offset: 0 });
  });

  it("measures the slot from the widths that end up before it", () => {
    // Uneven tabs: the 40px one landing first leaves it centred on 20, not on
    // the 30 its neighbour's width would put it at.
    const uneven: Slot[] = [
      { left: 0, width: 60 },
      { left: 60, width: 200 },
      { left: 260, width: 40 },
    ];

    expect(dragLayout(uneven, 29, 2)).toEqual({ toIndex: 0, offset: 9 });
  });

  it("has nothing to say about a tab that is no longer there", () => {
    expect(dragLayout(SLOTS, 160, -1)).toEqual({ toIndex: -1, offset: 0 });
  });
});

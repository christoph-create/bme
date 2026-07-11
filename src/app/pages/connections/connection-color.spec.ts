import { describe, expect, it } from "vitest";

import { colorForConnectionId } from "./connection-color";

describe("colorForConnectionId", () => {
  it("returns the same color for the same id every time", () => {
    const id = "11111111-1111-1111-1111-111111111111";

    expect(colorForConnectionId(id)).toBe(colorForConnectionId(id));
  });

  it("returns a color from the fixed 5-swatch palette", () => {
    const palette = [
      "rgb(249 115 22)",
      "rgb(59 130 246)",
      "rgb(239 68 68)",
      "rgb(34 197 94)",
      "rgb(168 85 247)",
    ];

    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) {
      expect(palette).toContain(colorForConnectionId(id));
    }
  });

  it("varies across different ids", () => {
    const colors = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map(colorForConnectionId),
    );

    expect(colors.size).toBeGreaterThan(1);
  });
});

import { describe, expect, it } from "vitest";

import { computeChartGeometry } from "./chart-geometry";
import { Sample } from "./sample-series";

const SIZE = { width: 600, height: 160 };

function series(values: readonly number[], stepMs = 1000): readonly Sample[] {
  return values.map((v, index) => ({ t: index * stepMs, v }));
}

describe("computeChartGeometry", () => {
  it("returns an empty geometry with a usable placeholder domain for no samples", () => {
    const geometry = computeChartGeometry([], SIZE);

    expect(geometry.points).toEqual([]);
    expect(geometry.polyline).toBe("");
    expect(geometry.area).toBe("");
    expect(geometry.valueDomain).toEqual({ min: 0, max: 1 });
    expect(geometry.timeSpanMs).toBe(0);
  });

  it("centres a single sample instead of pinning it to an edge", () => {
    const geometry = computeChartGeometry(series([20]), SIZE);

    expect(geometry.points).toEqual([{ x: 300, y: 80 }]);
    expect(geometry.polyline).toBe("");
    expect(geometry.area).toBe("");
  });

  it("spans the full width from oldest to newest", () => {
    const geometry = computeChartGeometry(series([0, 5, 10]), SIZE);

    expect(geometry.points[0].x).toBe(0);
    expect(geometry.points[2].x).toBe(600);
    expect(geometry.timeSpanMs).toBe(2000);
  });

  it("inverts the value axis so the maximum sits at the top", () => {
    const geometry = computeChartGeometry(series([0, 10]), SIZE);

    expect(geometry.points[0].y).toBe(160);
    expect(geometry.points[1].y).toBe(0);
  });

  it("positions points proportionally to their timestamps, not their index", () => {
    const samples: readonly Sample[] = [
      { t: 0, v: 0 },
      { t: 900, v: 1 },
      { t: 1000, v: 2 },
    ];

    const geometry = computeChartGeometry(samples, SIZE);

    expect(geometry.points[1].x).toBe(540);
  });

  it("spreads samples evenly by index when they share a timestamp", () => {
    const samples: readonly Sample[] = [
      { t: 500, v: 1 },
      { t: 500, v: 2 },
      { t: 500, v: 3 },
    ];

    const geometry = computeChartGeometry(samples, SIZE);

    expect(geometry.points.map((p) => p.x)).toEqual([0, 300, 600]);
    expect(geometry.timeSpanMs).toBe(0);
  });

  it("pads a flat series proportionally and draws it down the middle", () => {
    const geometry = computeChartGeometry(series([20, 20, 20]), SIZE);

    expect(geometry.valueDomain).toEqual({ min: 18, max: 22 });
    expect(geometry.points.map((p) => p.y)).toEqual([80, 80, 80]);
  });

  it("pads a flat series sitting on zero, where a proportional pad would be nothing", () => {
    const geometry = computeChartGeometry(series([0, 0]), SIZE);

    expect(geometry.valueDomain).toEqual({ min: -1, max: 1 });
  });

  it("handles negative and mixed-sign values", () => {
    const geometry = computeChartGeometry(series([-10, 0, 10]), SIZE);

    expect(geometry.valueDomain).toEqual({ min: -10, max: 10 });
    expect(geometry.points[1].y).toBe(80);
  });

  it("builds a polyline attribute from the points", () => {
    const geometry = computeChartGeometry(series([0, 10]), SIZE);

    expect(geometry.polyline).toBe("0,160 600,0");
  });

  it("closes the area path down to the baseline at both ends", () => {
    const geometry = computeChartGeometry(series([0, 10]), SIZE);

    expect(geometry.area).toBe("M 0 160 L 0 160 L 600 0 L 600 160 Z");
  });

  it("drops value ticks that fall outside the domain rather than clamping them", () => {
    const geometry = computeChartGeometry(series([3, 7]), SIZE);

    for (const tick of geometry.valueTicks) {
      const value = Number(tick.label);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
  });

  it("places time ticks across the full width", () => {
    const geometry = computeChartGeometry(series([1, 2, 3]), SIZE);

    expect(geometry.timeTicks.map((t) => t.position)).toEqual([0, 300, 600]);
  });

  it("gives a single sample one time tick under its centred point", () => {
    const geometry = computeChartGeometry(series([20]), SIZE);

    expect(geometry.timeTicks).toHaveLength(1);
    expect(geometry.timeTicks[0].position).toBe(300);
  });
});

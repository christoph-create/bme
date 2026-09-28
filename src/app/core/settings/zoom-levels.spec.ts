import { describe, expect, it } from "vitest";

import {
  DEFAULT_ZOOM,
  ZOOM_LEVELS,
  formatZoomPercent,
  snapZoom,
  zoomIn,
  zoomOut,
} from "./zoom-levels";

describe("ZOOM_LEVELS", () => {
  it("is ascending, contains 100%, and starts at the default", () => {
    expect([...ZOOM_LEVELS].sort((a, b) => a - b)).toEqual([...ZOOM_LEVELS]);
    expect(ZOOM_LEVELS).toContain(DEFAULT_ZOOM);
    expect(ZOOM_LEVELS[0]).toBe(0.8);
    expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).toBe(2);
  });
});

describe("snapZoom", () => {
  it("leaves a level untouched", () => {
    for (const level of ZOOM_LEVELS) {
      expect(snapZoom(level)).toBe(level);
    }
  });

  it("pulls a value between levels onto the nearest one", () => {
    expect(snapZoom(1.2)).toBe(1.25);
    expect(snapZoom(1.13)).toBe(1.1);
    expect(snapZoom(1.6)).toBe(1.5);
    expect(snapZoom(1.7)).toBe(1.75);
  });

  it("clamps outside the range", () => {
    expect(snapZoom(0.1)).toBe(0.8);
    expect(snapZoom(-3)).toBe(0.8);
    expect(snapZoom(99)).toBe(2);
  });

  it("falls back to the default for a value that is not a number", () => {
    expect(snapZoom(NaN)).toBe(DEFAULT_ZOOM);
    expect(snapZoom(Infinity)).toBe(DEFAULT_ZOOM);
  });
});

describe("zoomIn / zoomOut", () => {
  it("walks one step at a time", () => {
    expect(zoomIn(1)).toBe(1.1);
    expect(zoomIn(1.1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.9);
    expect(zoomOut(0.9)).toBe(0.8);
  });

  it("stops at the ends rather than wrapping", () => {
    expect(zoomIn(2)).toBe(2);
    expect(zoomOut(0.8)).toBe(0.8);
  });

  it("steps from the nearest level when handed something in between", () => {
    expect(zoomIn(1.2)).toBe(1.5);
    expect(zoomOut(1.2)).toBe(1.1);
  });

  it("walks the whole range and back", () => {
    let zoom = ZOOM_LEVELS[0];
    for (let i = 0; i < ZOOM_LEVELS.length * 2; i++) {
      zoom = zoomIn(zoom);
    }
    expect(zoom).toBe(2);
    for (let i = 0; i < ZOOM_LEVELS.length * 2; i++) {
      zoom = zoomOut(zoom);
    }
    expect(zoom).toBe(0.8);
  });
});

describe("formatZoomPercent", () => {
  it("renders a factor as a whole percentage", () => {
    expect(formatZoomPercent(1)).toBe("100%");
    expect(formatZoomPercent(1.25)).toBe("125%");
    expect(formatZoomPercent(0.8)).toBe("80%");
    expect(formatZoomPercent(2)).toBe("200%");
  });
});

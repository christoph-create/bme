import { describe, expect, it } from "vitest";

import { decimalsForStep, niceTicks } from "./axis-ticks";

describe("niceTicks", () => {
  it("picks a round step for a plain range", () => {
    const { step, values } = niceTicks(0, 100, 5);

    expect(step).toBe(20);
    expect(values).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("picks a sub-integer step for a small range", () => {
    const { step } = niceTicks(0, 1, 5);

    expect(step).toBe(0.2);
  });

  it("never accumulates floating-point error into the labels", () => {
    const { values } = niceTicks(0, 0.5, 5);

    expect(values).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it("puts a tick exactly on zero for a range spanning it", () => {
    const { values } = niceTicks(-40, 60, 5);

    expect(values).toContain(0);
  });

  it("handles a very large range", () => {
    const { step, values } = niceTicks(0, 1e9, 5);

    expect(step).toBe(2e8);
    expect(values[values.length - 1]).toBe(1e9);
  });

  it("handles a range far below one", () => {
    const { values } = niceTicks(0.001, 0.005, 4);

    expect(values).toEqual([0.001, 0.002, 0.003, 0.004, 0.005]);
  });

  it("treats swapped bounds as the same range", () => {
    expect(niceTicks(100, 0, 5)).toEqual(niceTicks(0, 100, 5));
  });

  it("returns a single value and a zero step for an empty range", () => {
    expect(niceTicks(5, 5, 4)).toEqual({ step: 0, values: [5] });
  });

  it("still produces a usable scale when asked for fewer than two ticks", () => {
    const { step, values } = niceTicks(0, 100, 1);

    expect(step).toBeGreaterThan(0);
    expect(values.length).toBeGreaterThan(1);
  });
});

describe("decimalsForStep", () => {
  it("needs no decimals for an integer step", () => {
    expect(decimalsForStep(20)).toBe(0);
    expect(decimalsForStep(1)).toBe(0);
  });

  it("matches the step's own precision below one", () => {
    expect(decimalsForStep(0.5)).toBe(1);
    expect(decimalsForStep(0.2)).toBe(1);
    expect(decimalsForStep(0.01)).toBe(2);
  });

  it("returns zero for a degenerate step", () => {
    expect(decimalsForStep(0)).toBe(0);
  });
});

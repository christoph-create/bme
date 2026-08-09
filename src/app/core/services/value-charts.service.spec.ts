import { beforeEach, describe, expect, it } from "vitest";

import { ValueChartsService } from "./value-charts.service";

describe("ValueChartsService", () => {
  let service: ValueChartsService;

  beforeEach(() => {
    service = new ValueChartsService();
  });

  function addTemp(overrides: Partial<Parameters<ValueChartsService["add"]>[0]> = {}): void {
    service.add({
      connectionId: "conn-1",
      topic: "sensors/kitchen",
      fieldPath: ["temp"],
      label: "temp",
      ...overrides,
    });
  }

  it("starts with no charts", () => {
    expect(service.charts()).toEqual([]);
  });

  it("adds a chart", () => {
    addTemp();

    expect(service.charts()).toHaveLength(1);
    expect(service.charts()[0]).toMatchObject({
      connectionId: "conn-1",
      topic: "sensors/kitchen",
      fieldPath: ["temp"],
      label: "temp",
    });
  });

  it("ignores a second add of the same topic and field", () => {
    addTemp();
    addTemp();

    expect(service.charts()).toHaveLength(1);
  });

  it("keeps two fields on the same topic apart", () => {
    addTemp();
    addTemp({ fieldPath: ["humidity"], label: "humidity" });

    expect(service.charts()).toHaveLength(2);
  });

  it("gives each chart a distinct id", () => {
    addTemp();
    addTemp({ topic: "sensors/hall" });

    const [first, second] = service.charts();
    expect(first.id).not.toBe(second.id);
  });

  it("keeps connections separate", () => {
    addTemp();
    addTemp({ connectionId: "conn-2" });

    expect(service.charts()).toHaveLength(2);
    expect(service.isCharted("conn-2", "sensors/kitchen", ["temp"])).toBe(true);
  });

  it("removes a chart by id", () => {
    addTemp();
    const [chart] = service.charts();

    service.remove(chart.id);

    expect(service.charts()).toEqual([]);
  });

  it("removes every chart for one connection, leaving the others", () => {
    addTemp();
    addTemp({ connectionId: "conn-2" });

    service.removeAllFor("conn-1");

    expect(service.charts()).toHaveLength(1);
    expect(service.charts()[0].connectionId).toBe("conn-2");
  });

  describe("isCharted", () => {
    it("is false for an unknown topic", () => {
      addTemp();

      expect(service.isCharted("conn-1", "sensors/hall", ["temp"])).toBe(false);
    });

    it("is false for a different connection", () => {
      addTemp();

      expect(service.isCharted("conn-2", "sensors/kitchen", ["temp"])).toBe(
        false,
      );
    });

    it("distinguishes a dotted key from a two-step path", () => {
      addTemp({ fieldPath: ["a.b"], label: "a.b" });

      expect(service.isCharted("conn-1", "sensors/kitchen", ["a.b"])).toBe(true);
      expect(service.isCharted("conn-1", "sensors/kitchen", ["a", "b"])).toBe(
        false,
      );
    });

    it("matches an empty path for a bare numeric payload", () => {
      addTemp({ fieldPath: [], label: "kitchen" });

      expect(service.isCharted("conn-1", "sensors/kitchen", [])).toBe(true);
    });
  });

  describe("find", () => {
    it("returns the matching chart", () => {
      addTemp();

      expect(service.find("conn-1", "sensors/kitchen", ["temp"])?.label).toBe(
        "temp",
      );
    });

    it("returns undefined when nothing matches", () => {
      expect(service.find("conn-1", "sensors/kitchen", ["temp"])).toBeUndefined();
    });
  });
});

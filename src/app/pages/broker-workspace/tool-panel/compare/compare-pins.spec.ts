import { describe, expect, it } from "vitest";

import { StoredMessage } from "../../../../core/models/stored-message.model";
import { pinSlot, togglePin } from "./compare-pins";

function message(receivedAt = 0): StoredMessage {
  return {
    payload: [],
    payloadLen: 0,
    qos: "AtMostOnce",
    retain: false,
    properties: null,
    receivedAt,
  };
}

describe("togglePin", () => {
  it("pins the first message as the baseline, with B still following", () => {
    const first = message();
    const pins = togglePin(null, "sensors/temp", first, 1_700);
    expect(pins).toEqual({
      topic: "sensors/temp",
      a: first,
      b: null,
      pinnedAt: 1_700,
    });
  });

  it("replaces a pin taken on another topic wholesale", () => {
    const old = message(1);
    const fresh = message(2);
    const first = togglePin(null, "a", old, 1);
    const second = togglePin(first, "b", fresh, 2);
    expect(second).toEqual({ topic: "b", a: fresh, b: null, pinnedAt: 2 });
  });

  it("returns to live when the baseline is clicked again", () => {
    const baseline = message();
    const pins = togglePin(null, "t", baseline, 0);
    expect(togglePin(pins, "t", baseline, 1)).toBeNull();
  });

  it("returns to live when the baseline is clicked even with B pinned", () => {
    const baseline = message(1);
    const other = message(2);
    const withB = togglePin(togglePin(null, "t", baseline, 0), "t", other, 1);
    expect(togglePin(withB, "t", baseline, 2)).toBeNull();
  });

  it("lets B resume following when B is clicked again, leaving A put", () => {
    const baseline = message(1);
    const other = message(2);
    const withB = togglePin(togglePin(null, "t", baseline, 0), "t", other, 1);
    expect(togglePin(withB, "t", other, 2)).toEqual({
      topic: "t",
      a: baseline,
      b: null,
      pinnedAt: 0,
    });
  });

  it("makes a second message B", () => {
    const baseline = message(1);
    const other = message(2);
    const pins = togglePin(togglePin(null, "t", baseline, 0), "t", other, 1);
    expect(pins?.a).toBe(baseline);
    expect(pins?.b).toBe(other);
  });

  it("replaces B rather than running out of slots", () => {
    const baseline = message(1);
    const second = message(2);
    const third = message(3);
    let pins = togglePin(null, "t", baseline, 0);
    pins = togglePin(pins, "t", second, 1);
    pins = togglePin(pins, "t", third, 2);
    expect(pins?.a).toBe(baseline);
    expect(pins?.b).toBe(third);
  });

  it("keeps the original pinnedAt when only B changes", () => {
    const baseline = message(1);
    const pins = togglePin(togglePin(null, "t", baseline, 500), "t", message(2), 900);
    expect(pins?.pinnedAt).toBe(500);
  });

  it("matches by reference, so two messages sharing a receivedAt are distinct", () => {
    const baseline = message(42);
    const twin = message(42);
    const pins = togglePin(null, "t", baseline, 0);
    // The collision the whole design exists for: clicking the twin must pin
    // it as B, not read as "the baseline again" and return to live.
    const next = togglePin(pins, "t", twin, 1);
    expect(next?.a).toBe(baseline);
    expect(next?.b).toBe(twin);
  });
});

describe("pinSlot", () => {
  it("reports no slot when nothing is pinned", () => {
    expect(pinSlot(null, "t", message())).toBeNull();
  });

  it("names the baseline A and the compared message B", () => {
    const a = message(1);
    const b = message(2);
    const pins = togglePin(togglePin(null, "t", a, 0), "t", b, 1);
    expect(pinSlot(pins, "t", a)).toBe("A");
    expect(pinSlot(pins, "t", b)).toBe("B");
  });

  it("reports no slot for an unpinned message", () => {
    const pins = togglePin(null, "t", message(1), 0);
    expect(pinSlot(pins, "t", message(2))).toBeNull();
  });

  it("reports no slot while another topic is on screen", () => {
    const a = message(1);
    const pins = togglePin(null, "t", a, 0);
    expect(pinSlot(pins, "other", a)).toBeNull();
    expect(pinSlot(pins, null, a)).toBeNull();
  });
});

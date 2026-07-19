import { describe, expect, it } from "vitest";

import { qosFromNumber, qosNumber, QoS } from "./qos";

describe("qosNumber / qosFromNumber", () => {
  it("round-trips every QoS level through its numeric form", () => {
    const levels: readonly QoS[] = ["AtMostOnce", "AtLeastOnce", "ExactlyOnce"];
    for (const qos of levels) {
      expect(qosFromNumber(qosNumber(qos))).toBe(qos);
    }
  });

  it("maps each numeric level to the expected enum value", () => {
    expect(qosFromNumber(0)).toBe("AtMostOnce");
    expect(qosFromNumber(1)).toBe("AtLeastOnce");
    expect(qosFromNumber(2)).toBe("ExactlyOnce");
  });
});

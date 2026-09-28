import { describe, expect, it } from "vitest";

import {
  SYSTEM_TOPIC_FILTER,
  SYSTEM_TOPIC_PREFIX,
  isSystemTopic,
} from "./system-topics";

describe("isSystemTopic", () => {
  it("recognises the broker's own tree", () => {
    expect(isSystemTopic("$SYS/broker/uptime")).toBe(true);
    expect(isSystemTopic("$SYS/broker/clients/connected")).toBe(true);
  });

  it("leaves the user's topics alone", () => {
    expect(isSystemTopic("home/livingroom/climate")).toBe(false);
    expect(isSystemTopic("sensors/$SYS/temp")).toBe(false);
  });

  /** A bare `$SYS` is not part of the tree, and `$SYSTEM` is somebody's
   * ordinary topic that happens to start with the same letters. */
  it("needs the separator, not just the letters", () => {
    expect(isSystemTopic("$SYS")).toBe(false);
    expect(isSystemTopic("$SYSTEM/x")).toBe(false);
  });

  it("handles the empty topic", () => {
    expect(isSystemTopic("")).toBe(false);
  });
});

describe("the filter", () => {
  /** The wildcard has to be spelled out: MQTT forbids `#` from matching a
   * leading `$`, so `#` alone would never deliver any of this. */
  it("subscribes under the prefix it recognises", () => {
    expect(SYSTEM_TOPIC_FILTER).toBe(`${SYSTEM_TOPIC_PREFIX}#`);
  });
});

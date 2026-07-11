import { describe, expect, it } from "vitest";

import { StoredMessage } from "../../../core/models/stored-message.model";
import { buildTopicTree } from "./build-topic-tree";
import { findUpdatedLeafPaths } from "./find-updated-leaf-paths";

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    payload: [1, 2, 3],
    qos: "AtMostOnce",
    retain: false,
    receivedAt: Date.now(),
    ...overrides,
  };
}

describe("findUpdatedLeafPaths", () => {
  it("returns nothing when nothing changed", () => {
    const msg = message();
    const previous = buildTopicTree(new Map([["sensors/temp", [msg]]]));
    const next = buildTopicTree(new Map([["sensors/temp", [msg]]]));

    expect(findUpdatedLeafPaths(previous, next)).toEqual([]);
  });

  it("flags a leaf whose last message changed", () => {
    const first = message();
    const second = message();
    const previous = buildTopicTree(new Map([["sensors/temp", [first]]]));
    const next = buildTopicTree(
      new Map([["sensors/temp", [first, second]]]),
    );

    expect(findUpdatedLeafPaths(previous, next)).toEqual(["sensors/temp"]);
  });

  it("flags a brand-new topic that didn't exist before", () => {
    const previous = buildTopicTree(new Map());
    const next = buildTopicTree(new Map([["device", [message()]]]));

    expect(findUpdatedLeafPaths(previous, next)).toEqual(["device"]);
  });

  it("only flags the topics that actually changed, leaving others out", () => {
    const unchanged = message();
    const first = message();
    const second = message();
    const previous = buildTopicTree(
      new Map([
        ["a", [unchanged]],
        ["b", [first]],
      ]),
    );
    const next = buildTopicTree(
      new Map([
        ["a", [unchanged]],
        ["b", [first, second]],
      ]),
    );

    expect(findUpdatedLeafPaths(previous, next)).toEqual(["b"]);
  });

  it("finds changes across nested folders", () => {
    const first = message();
    const second = message();
    const previous = buildTopicTree(
      new Map([["sensors/factory/zone-a/vibration", [first]]]),
    );
    const next = buildTopicTree(
      new Map([["sensors/factory/zone-a/vibration", [first, second]]]),
    );

    expect(findUpdatedLeafPaths(previous, next)).toEqual([
      "sensors/factory/zone-a/vibration",
    ]);
  });
});

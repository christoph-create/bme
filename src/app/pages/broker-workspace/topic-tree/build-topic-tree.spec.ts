import { describe, expect, it } from "vitest";

import { StoredMessage } from "../../../core/models/stored-message.model";
import {
  TopicFolderNode,
  TopicLeafNode,
  buildTopicTree,
  collectFolderPaths,
  countLeaves,
} from "./build-topic-tree";

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    payload: [1, 2, 3],
    qos: "AtMostOnce",
    retain: false,
    receivedAt: Date.now(),
    ...overrides,
  };
}

function topics(
  entries: Record<string, StoredMessage[]>,
): ReadonlyMap<string, readonly StoredMessage[]> {
  return new Map(Object.entries(entries));
}

describe("buildTopicTree", () => {
  it("returns an empty tree for no topics", () => {
    expect(buildTopicTree(topics({}))).toEqual([]);
  });

  it("builds a single leaf node for a flat topic", () => {
    const msg = message();
    const tree = buildTopicTree(topics({ home: [msg] }));

    expect(tree).toEqual([
      {
        kind: "leaf",
        name: "home",
        path: "home",
        messageCount: 1,
        lastMessage: msg,
      } satisfies TopicLeafNode,
    ]);
  });

  it("nests a two-segment topic under a folder", () => {
    const msg = message();
    const tree = buildTopicTree(topics({ "sensors/temp": [msg] }));

    expect(tree).toEqual([
      {
        kind: "folder",
        name: "sensors",
        path: "sensors",
        leafCount: 1,
        children: [
          {
            kind: "leaf",
            name: "temp",
            path: "sensors/temp",
            messageCount: 1,
            lastMessage: msg,
          },
        ],
      } satisfies TopicFolderNode,
    ]);
  });

  it("merges sibling topics under a shared folder", () => {
    const tree = buildTopicTree(
      topics({
        "sensors/temp": [message()],
        "sensors/humidity": [message()],
      }),
    );

    expect(tree).toHaveLength(1);
    const [sensors] = tree as [TopicFolderNode];
    expect(sensors.kind).toBe("folder");
    expect(sensors.leafCount).toBe(2);
    expect(sensors.children.map((c) => c.name)).toEqual([
      "humidity",
      "temp",
    ]);
  });

  it("computes leaf counts recursively through deep nesting, matching the prototype's shape", () => {
    const tree = buildTopicTree(
      topics({
        "sensors/factory-floor-01/zone-a/pressure": [message()],
        "sensors/factory-floor-01/zone-a/vibration": [message()],
        "sensors/factory-floor-01/zone-b/temperature": [message()],
      }),
    );

    const sensors = tree[0] as TopicFolderNode;
    const factoryFloor = sensors.children[0] as TopicFolderNode;
    const zoneA = factoryFloor.children.find(
      (c) => c.name === "zone-a",
    ) as TopicFolderNode;
    const zoneB = factoryFloor.children.find(
      (c) => c.name === "zone-b",
    ) as TopicFolderNode;

    expect(sensors.leafCount).toBe(3);
    expect(factoryFloor.leafCount).toBe(3);
    expect(zoneA.leafCount).toBe(2);
    expect(zoneB.leafCount).toBe(1);
  });

  it("uses the message count and last (most recent) message for each leaf", () => {
    const first = message({ receivedAt: 1 });
    const second = message({ receivedAt: 2 });
    const tree = buildTopicTree(topics({ "a/b": [first, second] }));

    const leaf = (tree[0] as TopicFolderNode).children[0] as TopicLeafNode;
    expect(leaf.messageCount).toBe(2);
    expect(leaf.lastMessage).toBe(second);
  });

  it("sorts siblings alphabetically at every level", () => {
    const tree = buildTopicTree(
      topics({
        zebra: [message()],
        apple: [message()],
        mango: [message()],
      }),
    );

    expect(tree.map((n) => n.name)).toEqual(["apple", "mango", "zebra"]);
  });
});

describe("countLeaves", () => {
  it("counts every distinct topic across the whole tree", () => {
    const tree = buildTopicTree(
      topics({
        "home/livingroom/temperature": [message()],
        "home/kitchen/humidity": [message()],
        "home/kitchen/smoke-alarm": [message()],
        device: [message()],
      }),
    );

    expect(countLeaves(tree)).toBe(4);
  });
});

describe("collectFolderPaths", () => {
  it("returns every folder path, including nested ones, but no leaf paths", () => {
    const tree = buildTopicTree(
      topics({
        "sensors/factory-floor-01/zone-a/pressure": [message()],
        device: [message()],
      }),
    );

    expect(collectFolderPaths(tree).sort()).toEqual(
      [
        "sensors",
        "sensors/factory-floor-01",
        "sensors/factory-floor-01/zone-a",
      ].sort(),
    );
  });
});

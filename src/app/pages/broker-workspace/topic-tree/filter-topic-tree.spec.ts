import { describe, expect, it } from "vitest";

import { StoredMessage } from "../../../core/models/stored-message.model";
import {
  TopicFolderNode,
  TopicLeafNode,
  buildTopicTree,
  countLeaves,
} from "./build-topic-tree";
import { filterTopicTree } from "./filter-topic-tree";

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    payload: [1, 2, 3],
    qos: "AtMostOnce",
    retain: false,
    receivedAt: Date.now(),
    ...overrides,
  };
}

function tree(...paths: string[]) {
  return buildTopicTree(
    new Map(paths.map((path) => [path, [message()]] as const)),
  );
}

/** Flattens back to the leaf paths that survived, which is what the filter is
 * actually judged on - the folder scaffolding around them follows from it. */
function leafPaths(nodes: readonly (TopicFolderNode | TopicLeafNode)[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "leaf" ? [node.path] : leafPaths(node.children),
  );
}

describe("filterTopicTree", () => {
  it("returns everything for an empty query", () => {
    const nodes = tree("sensors/temp", "device");
    expect(filterTopicTree(nodes, "")).toEqual(nodes);
  });

  it("returns everything for a whitespace-only query", () => {
    const nodes = tree("sensors/temp", "device");
    expect(filterTopicTree(nodes, "   ")).toEqual(nodes);
  });

  it("keeps only leaves whose full path contains the query", () => {
    const nodes = tree("sensors/temp", "sensors/humidity", "device/status");

    expect(leafPaths(filterTopicTree(nodes, "temp"))).toEqual(["sensors/temp"]);
  });

  it("matches against the full path, not just the leaf name", () => {
    const nodes = tree("sensors/temp", "device/status");

    expect(leafPaths(filterTopicTree(nodes, "device"))).toEqual([
      "device/status",
    ]);
  });

  it("matches case-insensitively", () => {
    const nodes = tree("Sensors/Temperature");

    expect(leafPaths(filterTopicTree(nodes, "TEMPER"))).toEqual([
      "Sensors/Temperature",
    ]);
  });

  it("keeps every child of a folder whose own path matches", () => {
    const nodes = tree(
      "sensors/temp",
      "sensors/humidity",
      "sensors/deep/nested/value",
      "device/status",
    );

    expect(leafPaths(filterTopicTree(nodes, "sensors"))).toEqual([
      "sensors/deep/nested/value",
      "sensors/humidity",
      "sensors/temp",
    ]);
  });

  it("keeps parent folders of a matching leaf, pruned to the matching branch", () => {
    const nodes = tree(
      "home/kitchen/humidity",
      "home/kitchen/smoke-alarm",
      "home/livingroom/humidity",
    );

    const filtered = filterTopicTree(nodes, "smoke");
    expect(leafPaths(filtered)).toEqual(["home/kitchen/smoke-alarm"]);

    const home = filtered[0] as TopicFolderNode;
    expect(home.children.map((child) => child.name)).toEqual(["kitchen"]);
  });

  it("recomputes leafCount so folder counts describe what is shown", () => {
    const nodes = tree(
      "home/kitchen/humidity",
      "home/kitchen/smoke-alarm",
      "home/livingroom/humidity",
    );

    const home = filterTopicTree(nodes, "smoke")[0] as TopicFolderNode;
    const kitchen = home.children[0] as TopicFolderNode;

    expect(home.leafCount).toBe(1);
    expect(kitchen.leafCount).toBe(1);
  });

  it("returns an empty tree when nothing matches", () => {
    const nodes = tree("sensors/temp", "device/status");

    expect(filterTopicTree(nodes, "nope")).toEqual([]);
  });

  it("preserves the alphabetical sibling order of the source tree", () => {
    const nodes = tree("a/x-value", "a/m-value", "a/z-value");

    const a = filterTopicTree(nodes, "value")[0] as TopicFolderNode;
    expect(a.children.map((child) => child.name)).toEqual([
      "m-value",
      "x-value",
      "z-value",
    ]);
  });

  it("leaves the source tree untouched", () => {
    const nodes = tree("home/kitchen/humidity", "home/livingroom/humidity");
    const before = countLeaves(nodes);

    filterTopicTree(nodes, "kitchen");

    expect(countLeaves(nodes)).toBe(before);
    expect((nodes[0] as TopicFolderNode).children).toHaveLength(2);
  });
});

import { StoredMessage } from "../../../core/models/stored-message.model";
import { TopicNode } from "./build-topic-tree";

function collectLastMessages(
  nodes: readonly TopicNode[],
  into: Map<string, StoredMessage>,
): void {
  for (const node of nodes) {
    if (node.kind === "leaf") {
      into.set(node.path, node.lastMessage);
    } else {
      collectLastMessages(node.children, into);
    }
  }
}

/**
 * Diffs two topic trees and returns the paths of leaves whose last message
 * changed (including brand-new leaves) - what should briefly "flash" in the UI.
 */
export function findUpdatedLeafPaths(
  previous: readonly TopicNode[],
  next: readonly TopicNode[],
): string[] {
  const previousLastMessages = new Map<string, StoredMessage>();
  collectLastMessages(previous, previousLastMessages);

  const nextLastMessages = new Map<string, StoredMessage>();
  collectLastMessages(next, nextLastMessages);

  const updated: string[] = [];
  for (const [path, lastMessage] of nextLastMessages) {
    if (previousLastMessages.get(path) !== lastMessage) {
      updated.push(path);
    }
  }
  return updated;
}

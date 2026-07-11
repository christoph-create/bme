import { StoredMessage } from "../../../core/models/stored-message.model";

export interface TopicLeafNode {
  kind: "leaf";
  name: string;
  path: string;
  messageCount: number;
  lastMessage: StoredMessage;
}

export interface TopicFolderNode {
  kind: "folder";
  name: string;
  path: string;
  leafCount: number;
  children: TopicNode[];
}

export type TopicNode = TopicFolderNode | TopicLeafNode;

interface MutableFolder {
  name: string;
  path: string;
  children: Map<string, MutableFolder | MutableLeaf>;
}

interface MutableLeaf {
  name: string;
  path: string;
  messages: readonly StoredMessage[];
}

function isMutableFolder(
  entry: MutableFolder | MutableLeaf,
): entry is MutableFolder {
  return "children" in entry;
}

/** Builds a nested topic tree from the flat connection/topic map kept by `MessageStoreService`. */
export function buildTopicTree(
  topics: ReadonlyMap<string, readonly StoredMessage[]>,
): TopicNode[] {
  const root = new Map<string, MutableFolder | MutableLeaf>();

  for (const [topic, messages] of topics) {
    const segments = topic.split("/");
    let level = root;
    let pathSoFar = "";

    segments.forEach((segment, index) => {
      pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
      const isLeafSegment = index === segments.length - 1;

      if (isLeafSegment) {
        level.set(segment, { name: segment, path: pathSoFar, messages });
        return;
      }

      const existing = level.get(segment);
      const folder =
        existing && isMutableFolder(existing)
          ? existing
          : { name: segment, path: pathSoFar, children: new Map() };
      level.set(segment, folder);
      level = folder.children;
    });
  }

  return convert(root);
}

function convert(level: Map<string, MutableFolder | MutableLeaf>): TopicNode[] {
  const nodes: TopicNode[] = [];

  for (const entry of level.values()) {
    if (isMutableFolder(entry)) {
      const children = convert(entry.children);
      nodes.push({
        kind: "folder",
        name: entry.name,
        path: entry.path,
        leafCount: countLeaves(children),
        children,
      });
    } else {
      nodes.push({
        kind: "leaf",
        name: entry.name,
        path: entry.path,
        messageCount: entry.messages.length,
        lastMessage: entry.messages[entry.messages.length - 1],
      });
    }
  }

  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}

/** Recursively sums the number of distinct leaf topics under a set of nodes. */
export function countLeaves(nodes: readonly TopicNode[]): number {
  return nodes.reduce(
    (total, node) => total + (node.kind === "leaf" ? 1 : node.leafCount),
    0,
  );
}

/** Collects every folder path in the tree (not leaves), for "expand all". */
export function collectFolderPaths(nodes: readonly TopicNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind === "folder") {
      paths.push(node.path);
      paths.push(...collectFolderPaths(node.children));
    }
  }
  return paths;
}

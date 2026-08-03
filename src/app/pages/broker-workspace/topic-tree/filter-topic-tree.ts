import { TopicNode, countLeaves } from "./build-topic-tree";

/**
 * Prunes a topic tree down to the nodes matching `query`, a case-insensitive
 * substring of the full topic path.
 *
 * A folder whose own path matches keeps all of its children - typing a folder
 * name is a request to see what's under it, not to see the folder by itself.
 * Otherwise a folder only survives because a descendant did, and keeps just
 * the surviving branch.
 */
export function filterTopicTree(
  nodes: readonly TopicNode[],
  query: string,
): TopicNode[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [...nodes];
  }
  return filterLevel(nodes, needle);
}

function filterLevel(nodes: readonly TopicNode[], needle: string): TopicNode[] {
  const kept: TopicNode[] = [];

  for (const node of nodes) {
    const selfMatches = node.path.toLowerCase().includes(needle);

    if (node.kind === "leaf") {
      if (selfMatches) {
        kept.push(node);
      }
      continue;
    }

    if (selfMatches) {
      kept.push(node);
      continue;
    }

    const children = filterLevel(node.children, needle);
    if (children.length > 0) {
      // leafCount has to be recomputed rather than carried over, or a folder
      // showing one match would still claim the unfiltered total.
      kept.push({ ...node, children, leafCount: countLeaves(children) });
    }
  }

  return kept;
}

import { SYSTEM_TOPIC_PREFIX } from "../../../../core/mqtt/system-topics";

/**
 * Segments that say where a reading lives rather than what it is.
 *
 * `$SYS` was never standardised, so every broker nests its numbers
 * differently: mosquitto publishes `$SYS/broker/subscriptions/count` and EMQX
 * publishes `$SYS/brokers/emqx@172.17.0.2/stats/subscriptions/count`. Drop
 * the scaffolding and both are `subscriptions` - which is the whole reason
 * this panel needs no per-broker code for most of what it shows.
 */
const CONTAINER_SEGMENTS: ReadonlySet<string> = new Set([
  "broker",
  "brokers",
  "stats",
  "metrics",
]);

/** A segment naming the cluster node, e.g. `emqx@172.17.0.2`. It identifies
 * the machine, never the reading, and including it would make every EMQX
 * topic unique to the host it came from. */
function isNodeSegment(segment: string): boolean {
  return segment.includes("@");
}

/**
 * Reduces a `$SYS` topic to what it means, independent of broker.
 *
 * Lower-cased, scaffolding removed, and a trailing `count` dropped - `count`
 * is the default reading of anything countable, while `max` is the one that
 * distinguishes, so `.../subscriptions/count` and `.../subscriptions` are the
 * same thing and `.../subscriptions/max` is not.
 *
 * A topic that is nothing but scaffolding (EMQX publishes the node name at
 * `$SYS/brokers`) keeps its last segment rather than normalising to nothing.
 */
export function normaliseSysTopic(topic: string): string {
  const withoutPrefix = topic.startsWith(SYSTEM_TOPIC_PREFIX)
    ? topic.slice(SYSTEM_TOPIC_PREFIX.length)
    : topic;

  const segments = withoutPrefix
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "")
    .filter(
      (segment) =>
        !CONTAINER_SEGMENTS.has(segment.toLowerCase()) &&
        !isNodeSegment(segment),
    )
    .map((segment) => segment.toLowerCase());

  if (segments.length === 0) {
    const fallback = withoutPrefix
      .split("/")
      .filter((s) => s !== "")
      .pop();
    return fallback?.toLowerCase() ?? "";
  }

  if (segments.length > 1 && segments[segments.length - 1] === "count") {
    segments.pop();
  }

  return segments.join("/");
}

/**
 * The `$SYS` topic space, which brokers use to publish their own health.
 *
 * It needs its own filter because MQTT forbids a wildcard from matching a
 * leading `$` (MQTT 3.1.1 s4.7.2): a subscription to `#` never carries a
 * single `$SYS` message, so reading them is always a deliberate, separate
 * act. That is what makes it safe to treat every `$SYS` topic as "traffic the
 * app asked for" rather than as the user's own data.
 *
 * `SYSTEM_TOPIC_FILTER` mirrors `SYSTEM_TOPIC_FILTER` in
 * `core/src/mqtt/system_topics.rs` - the backend owns the subscribe, this
 * side owns recognising what comes back.
 */
export const SYSTEM_TOPIC_PREFIX = "$SYS/";

export const SYSTEM_TOPIC_FILTER = "$SYS/#";

/** Whether a received topic belongs to the broker rather than to the user.
 *
 * Prefix, not `startsWith("$SYS")`: a bare `$SYS` with nothing under it is not
 * part of the tree, and `$SYSTEM/x` is somebody's ordinary topic. */
export function isSystemTopic(topic: string): boolean {
  return topic.startsWith(SYSTEM_TOPIC_PREFIX);
}

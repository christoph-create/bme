import { isSystemTopic } from "../../../core/mqtt/system-topics";
import { StoredMessage } from "../../../core/models/stored-message.model";

type Topics = ReadonlyMap<string, readonly StoredMessage[]>;

export interface SplitTopics {
  /** The user's own topics. */
  readonly user: Topics;
  /** The broker's `$SYS` tree, which the broker panel subscribes to on its
   * own account. */
  readonly system: Topics;
}

/**
 * Separates the broker's own `$SYS` topics from the user's.
 *
 * Applied to the flat map *before* `buildTopicTree` rather than to the tree
 * afterwards: cheaper, and it leaves every `leafCount` correct by
 * construction instead of needing the recount that `filterTopicTree` has to
 * do (see its comment).
 *
 * `$SYS` is hidden by default because a monitored mosquitto publishes some
 * forty topics under it every ten seconds, which buries a real tree - but it
 * is only hidden, never dropped: the history is what the broker panel plots,
 * and being able to read a raw `$SYS` message like any other is the whole
 * reason it goes through the ordinary store.
 */
export function splitSystemTopics(topics: Topics): SplitTopics {
  const user = new Map<string, readonly StoredMessage[]>();
  const system = new Map<string, readonly StoredMessage[]>();

  for (const [topic, messages] of topics) {
    (isSystemTopic(topic) ? system : user).set(topic, messages);
  }

  return { user, system };
}

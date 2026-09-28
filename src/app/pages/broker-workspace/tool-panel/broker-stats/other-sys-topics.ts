import { describeSysTopic } from "./sys-topics";

export interface OtherSysTopic {
  readonly topic: string;
  readonly value: string;
}

/**
 * Every `$SYS` topic the catalogue doesn't know, with its latest value.
 *
 * This is what makes the panel degrade instead of looking broken. `$SYS`
 * never made it into the MQTT specification, so EMQX publishes under
 * `$SYS/brokers/<node>/…`, HiveMQ and VerneMQ have their own trees, and none
 * of them match the mosquitto layout the catalogue is built from. Without
 * this table those brokers would show an empty dashboard and no explanation.
 *
 * Sorted by topic, because there is no meaningful order to impose on
 * something we by definition don't understand.
 */
export function otherSysTopics(
  latest: ReadonlyMap<string, string>,
): readonly OtherSysTopic[] {
  return [...latest]
    .filter(([topic]) => describeSysTopic(topic) === null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([topic, value]) => ({ topic, value }));
}

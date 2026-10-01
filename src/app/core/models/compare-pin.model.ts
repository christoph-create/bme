import { StoredMessage } from "./stored-message.model";

/**
 * The messages the user has frozen for the Compare tool.
 *
 * Both sides are held as the `StoredMessage` **object reference**, not as an
 * index and not as a timestamp. There is no message id: `receivedAt` is
 * `Date.now()` and collides under load, and a `(topic, index)` coordinate
 * shifts every time the store's per-topic cap drops the oldest message.
 * `MessageStoreService.append` spreads into a new array, so existing elements
 * keep their identity across every emission - the same property that
 * message-stream's measured row heights and value-chart-card's parse cache
 * already depend on.
 *
 * Holding the reference means a pinned baseline outlives its own eviction
 * from the per-topic cap, and outlives a Clear of the topic. That is the
 * point rather than a side effect: a baseline whose whole job is to stay put
 * while the topic moves on must not disappear after 500 messages. The card it
 * came from stops being rendered, so the stream's "Unpin" goes with it - the
 * tool's own chip is then the only way back to Live, which is why that
 * control is not optional.
 */
export interface ComparePins {
  /** The topic both sides were pinned on. Compare is same-topic only, so a
   * pin is in effect only while this topic is selected - it is kept rather
   * than cleared on a topic change, so coming back restores it. Recorded here
   * rather than implied, so a cross-topic compare stays buildable later
   * without changing the stored shape. */
  readonly topic: string;
  /** Side A: the frozen baseline, the "before" column. */
  readonly a: StoredMessage;
  /** Side B, or null while B follows the newest message on the topic - the
   * default after one click, and what makes "pin a baseline and watch the
   * next messages land against it" work. */
  readonly b: StoredMessage | null;
  /** `Date.now()` when side A was pinned. Not the message's own `receivedAt`,
   * which the A/B header already shows. */
  readonly pinnedAt: number;
}

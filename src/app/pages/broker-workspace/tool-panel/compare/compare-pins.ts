import { ComparePins } from "../../../../core/models/compare-pin.model";
import { StoredMessage } from "../../../../core/models/stored-message.model";

/**
 * Where a click on a card's "Compare" action leaves the pins.
 *
 * Four rules, in order - the only four a single action can express without
 * first asking the user which side they meant:
 *
 *  1. nothing pinned, or pinned on another topic -> this message becomes the
 *     baseline, and B goes back to following the newest message.
 *  2. clicking the baseline -> back to Live. Clicking the thing that froze the
 *     view is the most discoverable way to unfreeze it, and the tool's own
 *     chip offers the same exit for when the card has aged out of the stream.
 *  3. clicking the pinned B -> B resumes following the newest message, A stays
 *     put.
 *  4. anything else -> becomes B, replacing whatever B was. A third click on a
 *     third message means "show me *this* one against the baseline", not "I
 *     have run out of slots".
 *
 * Returns null for "no pins, back to Live", so the caller stores exactly one
 * shape rather than an empty-but-present pin.
 *
 * Messages are matched by reference, never by `receivedAt` - two messages
 * arriving in the same millisecond are distinct pins, which is the whole
 * reason the pin holds a reference in the first place. See `ComparePins`.
 */
export function togglePin(
  current: ComparePins | null,
  topic: string,
  message: StoredMessage,
  now: number,
): ComparePins | null {
  if (current === null || current.topic !== topic) {
    return { topic, a: message, b: null, pinnedAt: now };
  }

  if (current.a === message) {
    return null;
  }

  if (current.b === message) {
    return { ...current, b: null };
  }

  return { ...current, b: message };
}

/**
 * Which column a message feeds, or null when it is not pinned.
 *
 * `topic` is the topic the caller is showing: a pin taken on another topic is
 * not in effect, so its messages must not be badged while that other topic is
 * on screen.
 */
export function pinSlot(
  pins: ComparePins | null,
  topic: string | null,
  message: StoredMessage,
): "A" | "B" | null {
  if (pins === null || topic === null || pins.topic !== topic) {
    return null;
  }
  if (pins.a === message) {
    return "A";
  }
  return pins.b === message ? "B" : null;
}

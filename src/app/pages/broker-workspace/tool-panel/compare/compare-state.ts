import { ComparePins } from "../../../../core/models/compare-pin.model";
import { StoredMessage } from "../../../../core/models/stored-message.model";
import { decodePayload, looksBinary } from "../../format/payload-text";

export type CompareMode = "live" | "pinned";

/**
 * What the tool's body shows.
 *
 * Every one of these is a state the dock can really be in; naming them here
 * rather than as a pile of `@if`s in the template is the same move
 * `sysDashboardState` makes for the broker panel's five faces.
 */
export type CompareFace =
  /** Nothing selected in the topic tree. */
  | "no-topic"
  /** A topic is selected but nothing has arrived on it. */
  | "no-messages"
  /** One message, with nothing to compare it against. */
  | "single-message"
  /** The newest message *is* the pinned baseline. */
  | "awaiting-newer"
  /** A side is binary, empty, or did not arrive whole. */
  | "not-diffable"
  /** Both sides decode and the text matches. */
  | "identical"
  /** Both sides parse as JSON - the structural field table. */
  | "json"
  /** Anything else - the unified line diff. */
  | "lines";

export interface CompareSelection {
  readonly mode: CompareMode;
  /** The A / "before" column. Null when there is no second message to
   * compare against. */
  readonly before: StoredMessage | null;
  /** The B / "after" column. */
  readonly after: StoredMessage | null;
  /** True when both columns are the same message, i.e. the pin is on the
   * newest one and there is nothing newer yet. */
  readonly sameMessage: boolean;
}

export interface CompareSidesInput {
  readonly selectedTopic: string | null;
  /** The store's own history for `selectedTopic`, oldest first. */
  readonly messages: readonly StoredMessage[];
  readonly pins: ComparePins | null;
}

/**
 * Which two messages the tool compares.
 *
 * Live takes the newest two. Pinned freezes A and lets B keep following the
 * newest message unless B is pinned too - that is the whole point of pinning
 * one side.
 *
 * A pin taken on another topic is not in effect: compare is same-topic only,
 * so it falls back to live rather than diffing across topics, and the pin is
 * kept so returning to its topic restores it.
 *
 * Note A is read straight off the pin rather than looked up in `messages`.
 * The baseline therefore survives being evicted by the store's per-topic cap,
 * which is the behaviour `ComparePins` exists to provide.
 */
export function selectCompareSides(
  input: CompareSidesInput,
): CompareSelection {
  const { selectedTopic, messages, pins } = input;
  const newest = messages.at(-1) ?? null;
  const inEffect =
    pins !== null && selectedTopic !== null && pins.topic === selectedTopic;

  if (!inEffect) {
    const before = messages.length >= 2 ? messages[messages.length - 2] : null;
    return { mode: "live", before, after: newest, sameMessage: false };
  }

  const after = pins.b ?? newest;
  return {
    mode: "pinned",
    before: pins.a,
    after,
    sameMessage: after === pins.a,
  };
}

/**
 * One side's payload as something diffable, or why it is not.
 *
 * Decoded here rather than reused from the message stream, for exactly the
 * reason `messageToDraft` documents: `formatMessageBody` yields the sentinels
 * `"(empty)"` and `"<binary, 412 bytes>"` and appends `"…"` when it clips, so
 * diffing `MessageView.body` would diff labels and ellipses rather than
 * payloads.
 */
export type SideText =
  | { readonly ok: true; readonly text: string; readonly json: boolean }
  | {
      readonly ok: false;
      readonly reason: "empty" | "binary" | "truncated";
    };

/**
 * `isJson` is passed in rather than imported so this stays free of Angular DI
 * - callers hand it `JsonFormatService.format(text).ok`, the same contract
 * `messageToDraft` uses.
 */
export function readSide(
  message: StoredMessage,
  isJson: (text: string) => boolean,
): SideText {
  if (message.payloadLen === 0) {
    return { ok: false, reason: "empty" };
  }

  // Only part of an oversize message crossed from the backend. Diffing a
  // prefix would invent removals that are really just the missing tail.
  if (message.payloadLen > message.payload.length) {
    return { ok: false, reason: "truncated" };
  }

  const text = decodePayload(message.payload);
  if (looksBinary(text)) {
    return { ok: false, reason: "binary" };
  }

  return { ok: true, text, json: isJson(text) };
}

export interface CompareFaceInput {
  readonly selectedTopic: string | null;
  readonly historyEmpty: boolean;
  readonly sameMessage: boolean;
  readonly before: SideText | null;
  readonly after: SideText | null;
}

/**
 * Which face to show, in precedence order.
 *
 * A pinned baseline with nothing newer to show it against is
 * `awaiting-newer`, and that beats `no-messages` - a pin outlives a Clear of
 * its topic, and "baseline pinned, waiting for the next message" is the
 * honest reading of that state rather than "no messages yet".
 *
 * `single-message` is decided by `before` being absent rather than by the
 * history's length: a pin whose baseline has been evicted leaves one message
 * in the store and is still perfectly comparable.
 *
 * `identical` wins over `json` so two matching payloads say so in one line
 * instead of rendering a table of nothing but unchanged rows.
 */
export function compareFace(input: CompareFaceInput): CompareFace {
  if (input.selectedTopic === null) {
    return "no-topic";
  }
  if (input.sameMessage || (input.before !== null && input.after === null)) {
    return "awaiting-newer";
  }
  if (input.historyEmpty) {
    return "no-messages";
  }
  if (input.before === null || input.after === null) {
    return "single-message";
  }
  if (!input.before.ok || !input.after.ok) {
    return "not-diffable";
  }
  if (input.before.text === input.after.text) {
    return "identical";
  }
  return input.before.json && input.after.json ? "json" : "lines";
}

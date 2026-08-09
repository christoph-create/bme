import { StoredMessage } from "../../../../core/models/stored-message.model";
import { readNumericAt } from "./numeric-fields";

export interface Sample {
  /** `StoredMessage.receivedAt` - epoch milliseconds. */
  readonly t: number;
  readonly v: number;
}

/**
 * Turns a topic's history into the (time, value) pairs a chart can plot.
 *
 * Messages with no finite value at `path` are dropped rather than plotted as
 * zero: a field that only appears in some payloads has to leave a gap in the
 * line, because a dip to zero reads as a real reading.
 *
 * `parse` is a parameter rather than a direct `parsePayload` call so the
 * caller can memoize decoding per message. The store hands back the whole
 * (<=500) history on every arrival, and re-decoding all of it each time is
 * the one thing that makes several open charts expensive.
 */
export function buildSamples(
  messages: readonly StoredMessage[],
  path: readonly string[],
  parse: (message: StoredMessage) => unknown,
): readonly Sample[] {
  const samples: Sample[] = [];
  for (const message of messages) {
    const value = readNumericAt(parse(message), path);
    if (value !== null) {
      samples.push({ t: message.receivedAt, v: value });
    }
  }
  return samples;
}

import { MessageDraft } from "../../../core/models/message-draft.model";
import { StoredMessage } from "../../../core/models/stored-message.model";
import { decodePayload, looksBinary } from "../format/payload-text";

/**
 * Turns a received message into a publish-panel draft, or `null` when its
 * payload can't be edited as text.
 *
 * Note this decodes the payload itself rather than reusing what the stream
 * already rendered: `formatMessageBody` yields the sentinels `"(empty)"` and
 * `"<binary, 412 bytes>"` for those cases, and loading either into the panel
 * as if it were the payload would publish that literal text.
 *
 * `isJson` is passed in rather than imported so this stays free of Angular DI
 * - callers hand it `JsonFormatService.format(text).ok`.
 */
export function messageToDraft(
  topic: string,
  message: StoredMessage,
  isJson: (text: string) => boolean,
): MessageDraft | null {
  if (message.payload.length === 0) {
    return null;
  }

  const payload = decodePayload(message.payload);
  if (looksBinary(payload)) {
    return null;
  }

  return {
    topic,
    payload,
    format: isJson(payload) ? "json" : "raw",
    qos: message.qos,
    retain: message.retain,
  };
}

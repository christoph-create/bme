const MAX_PREVIEW_BYTES = 200;
const MAX_PREVIEW_CHARS = 100;
const MAX_BODY_BYTES = 20_000;
const BINARY_SAMPLE_BYTES = 200;
const BINARY_REPLACEMENT_RATIO_THRESHOLD = 0.1;
const REPLACEMENT_CHAR = "�";

/**
 * Builds a short, single-line preview of a received payload for the topic tree.
 * Only ever decodes the first ~200 bytes, regardless of the payload's real size,
 * so a huge message doesn't get fully UTF-8-decoded just to show a one-line summary.
 *
 * `payloadLen` is what the message weighed on the wire, which is larger than
 * `payload` when the backend capped it - sizes shown to the user have to be the
 * real ones, not the size of the copy that made it across.
 */
export function formatPayloadPreview(
  payload: readonly number[],
  payloadLen: number = payload.length,
): string {
  if (payloadLen === 0) {
    return "(empty)";
  }

  const text = decode(payload.slice(0, MAX_PREVIEW_BYTES));

  if (looksBinary(text)) {
    return binaryLabel(payloadLen);
  }

  const collapsed = text.replace(/\s+/g, " ").trim();
  const truncated =
    payloadLen > MAX_PREVIEW_BYTES || collapsed.length > MAX_PREVIEW_CHARS;
  const shown = collapsed.slice(0, MAX_PREVIEW_CHARS);
  return truncated ? `${shown}…` : shown;
}

/**
 * Decodes the full body of a received payload for the messages panel,
 * preserving whitespace/newlines. Caps decoding at ~20,000 bytes so an
 * unusually large message doesn't stall the UI.
 *
 * Purely a byte/text concern - JSON pretty-printing and highlighting are
 * handled downstream by app-formatted-payload, fed this decoded text.
 *
 * `payloadLen` as in `formatPayloadPreview`.
 */
export function formatMessageBody(
  payload: readonly number[],
  payloadLen: number = payload.length,
): string {
  if (payloadLen === 0) {
    return "(empty)";
  }

  if (looksBinary(decode(payload.slice(0, BINARY_SAMPLE_BYTES)))) {
    return binaryLabel(payloadLen);
  }

  const truncated = payload.length > MAX_BODY_BYTES || payloadLen > payload.length;
  const text = decode(payload.slice(0, MAX_BODY_BYTES));
  return truncated ? `${text}…` : text;
}

/**
 * How the stream says a message arrived incomplete, or `null` when it didn't.
 *
 * Payloads over 256 KiB are capped before they leave the backend, and silently
 * showing the first quarter-megabyte as if it were the message would be a lie
 * about what the broker sent.
 */
export function formatTruncationNote(
  payloadLen: number,
  shownLen: number,
): string | null {
  if (payloadLen <= shownLen) {
    return null;
  }
  return `Truncated - showing the first ${humanBytes(shownLen)} of ${humanBytes(payloadLen)}`;
}

function humanBytes(bytes: number): string {
  const KB = 1024;
  const MB = 1024 * KB;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

function binaryLabel(byteLength: number): string {
  const unit = byteLength === 1 ? "byte" : "bytes";
  return `<binary, ${byteLength} ${unit}>`;
}

export function decodePayload(payload: readonly number[]): string {
  return decode(payload);
}

function decode(bytes: readonly number[]): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(
    Uint8Array.from(bytes),
  );
}

/** Whether decoded text is mostly replacement characters, i.e. the bytes
 * weren't text at all. Exported so callers that need the *real* decoded text
 * (rather than the `<binary, N bytes>` label) can make the same call. */
export function looksBinary(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  let replacementCount = 0;
  for (const char of text) {
    if (char === REPLACEMENT_CHAR) {
      replacementCount++;
    }
  }
  return replacementCount / text.length > BINARY_REPLACEMENT_RATIO_THRESHOLD;
}

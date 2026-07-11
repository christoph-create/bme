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
 */
export function formatPayloadPreview(payload: readonly number[]): string {
  if (payload.length === 0) {
    return "(empty)";
  }

  const text = decode(payload.slice(0, MAX_PREVIEW_BYTES));

  if (looksBinary(text)) {
    return binaryLabel(payload.length);
  }

  const collapsed = text.replace(/\s+/g, " ").trim();
  const truncated =
    payload.length > MAX_PREVIEW_BYTES || collapsed.length > MAX_PREVIEW_CHARS;
  const shown = collapsed.slice(0, MAX_PREVIEW_CHARS);
  return truncated ? `${shown}…` : shown;
}

/**
 * Renders the full body of a received payload for the messages panel,
 * preserving whitespace/newlines. Caps decoding at ~20,000 bytes so an
 * unusually large message doesn't stall the UI.
 */
export function formatMessageBody(payload: readonly number[]): string {
  if (payload.length === 0) {
    return "(empty)";
  }

  if (looksBinary(decode(payload.slice(0, BINARY_SAMPLE_BYTES)))) {
    return binaryLabel(payload.length);
  }

  const truncated = payload.length > MAX_BODY_BYTES;
  const text = decode(payload.slice(0, MAX_BODY_BYTES));
  return truncated ? `${text}…` : text;
}

function binaryLabel(byteLength: number): string {
  const unit = byteLength === 1 ? "byte" : "bytes";
  return `<binary, ${byteLength} ${unit}>`;
}

function decode(bytes: readonly number[]): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(
    Uint8Array.from(bytes),
  );
}

function looksBinary(text: string): boolean {
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

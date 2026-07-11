const MAX_PREVIEW_BYTES = 200;
const MAX_PREVIEW_CHARS = 100;
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

  const sample = payload.slice(0, MAX_PREVIEW_BYTES);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(
    Uint8Array.from(sample),
  );

  if (looksBinary(text)) {
    const unit = payload.length === 1 ? "byte" : "bytes";
    return `<binary, ${payload.length} ${unit}>`;
  }

  const collapsed = text.replace(/\s+/g, " ").trim();
  const truncated =
    payload.length > MAX_PREVIEW_BYTES || collapsed.length > MAX_PREVIEW_CHARS;
  const shown = collapsed.slice(0, MAX_PREVIEW_CHARS);
  return truncated ? `${shown}…` : shown;
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

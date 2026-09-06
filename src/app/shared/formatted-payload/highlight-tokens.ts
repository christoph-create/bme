export interface HighlightSegment {
  readonly text: string;
  readonly matched: boolean;
}

/**
 * Splits `text` into segments around case-insensitive occurrences of
 * `query`, so a caller can render the matched substrings differently without
 * losing anything else about the surrounding text. An empty/blank query - or
 * one that never occurs - yields the whole string as a single unmatched
 * segment, never zero-length segments.
 */
export function splitForHighlight(
  text: string,
  query: string,
): readonly HighlightSegment[] {
  const needle = query.trim();
  if (needle === "") {
    return [{ text, matched: false }];
  }

  const haystack = text.toLowerCase();
  const needleLower = needle.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (;;) {
    const index = haystack.indexOf(needleLower, cursor);
    if (index === -1) {
      break;
    }
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), matched: false });
    }
    segments.push({
      text: text.slice(index, index + needle.length),
      matched: true,
    });
    cursor = index + needle.length;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), matched: false });
  }

  return segments.length > 0 ? segments : [{ text, matched: false }];
}

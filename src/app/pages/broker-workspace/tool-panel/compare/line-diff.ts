// `decodePayload` decodes the whole payload, up to the backend's 256 KiB IPC
// cap - `payload-text`'s own 20,000-byte ceiling only applies to
// `formatMessageBody`, which the compare tool deliberately does not use. So
// these caps are what actually stands between a quarter-megabyte payload and
// an LCS table big enough to stall the UI.
/** Checked before splitting into lines, so a 256 KiB single-line payload is
 * refused without first allocating a line array for it. */
const MAX_DIFF_CHARS = 64_000;
/** Per side, measured *after* trimming the common prefix and suffix. The DP
 * table is then at most 600x600 cells, about 1.4 MB. */
const MAX_DIFF_LINES = 600;
/** `diff(1)`'s default, and what every reviewer's eye already expects. */
const DEFAULT_CONTEXT = 3;

export type LineDiffKind = "context" | "added" | "removed";

export interface LineDiffRow {
  readonly kind: LineDiffKind;
  /** 1-based line number on the A side, null for an added line. */
  readonly beforeLine: number | null;
  readonly afterLine: number | null;
  readonly text: string;
}

export interface LineDiffHunk {
  /** `@@ -12,4 +12,5 @@`, for the separator between hunks. */
  readonly header: string;
  readonly rows: readonly LineDiffRow[];
}

export interface LineDiff {
  readonly hunks: readonly LineDiffHunk[];
  readonly addedCount: number;
  readonly removedCount: number;
  /** Set when the payloads were too big to diff line by line. `hunks` is then
   * empty, so the view says so rather than showing a partial diff that looks
   * complete. */
  readonly tooLarge: boolean;
}

export interface LineDiffOptions {
  /** Unchanged lines kept either side of a change. */
  readonly context?: number;
}

/**
 * Unified line diff of two decoded payloads - the fallback for anything that
 * is not JSON on both sides.
 *
 * Hand-rolled rather than pulled from a package: this repo already hand-rolls
 * its SVG chart geometry, axis ticks, JSON tokenizer and highlight splitter,
 * and a prefix/suffix-trimmed LCS is about fifty lines with a spec.
 *
 * Lines are split on `"\n"` raw, with two visible consequences. `"a\n"` vs
 * `"a"` shows a trailing added empty line - ugly, but what `diff(1)` reports
 * too. And `\r\n` is *not* normalised against `\n`: a payload where one side
 * gained CRLF line endings is a real difference someone may be hunting, and
 * silently equalising them would hide it. `visibleLine` is how the view makes
 * the stray carriage return legible.
 */
export function diffLines(
  before: string,
  after: string,
  options: LineDiffOptions = {},
): LineDiff {
  const context = options.context ?? DEFAULT_CONTEXT;

  if (before.length > MAX_DIFF_CHARS || after.length > MAX_DIFF_CHARS) {
    return { hunks: [], addedCount: 0, removedCount: 0, tooLarge: true };
  }

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  // Trimming first is what keeps the DP trivial in the common case: two
  // payloads from the same device usually differ in a line or two, and this
  // collapses three hundred lines to three in a single linear pass.
  let head = 0;
  const shortest = Math.min(beforeLines.length, afterLines.length);
  while (head < shortest && beforeLines[head] === afterLines[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < shortest - head &&
    beforeLines[beforeLines.length - 1 - tail] ===
      afterLines[afterLines.length - 1 - tail]
  ) {
    tail++;
  }

  const beforeMiddle = beforeLines.slice(head, beforeLines.length - tail);
  const afterMiddle = afterLines.slice(head, afterLines.length - tail);

  if (
    beforeMiddle.length > MAX_DIFF_LINES ||
    afterMiddle.length > MAX_DIFF_LINES
  ) {
    return { hunks: [], addedCount: 0, removedCount: 0, tooLarge: true };
  }

  const kinds: { kind: LineDiffKind; text: string }[] = [];
  for (let i = 0; i < head; i++) {
    kinds.push({ kind: "context", text: beforeLines[i] });
  }
  kinds.push(...lcsRows(beforeMiddle, afterMiddle));
  for (let i = beforeLines.length - tail; i < beforeLines.length; i++) {
    kinds.push({ kind: "context", text: beforeLines[i] });
  }

  // Numbered in a second pass: the LCS walk only knows the shape of each row,
  // and both counters depend on every row before it.
  let beforeNo = 0;
  let afterNo = 0;
  let addedCount = 0;
  let removedCount = 0;
  const rows: LineDiffRow[] = kinds.map(({ kind, text }) => {
    if (kind === "added") {
      addedCount++;
      return { kind, beforeLine: null, afterLine: ++afterNo, text };
    }
    if (kind === "removed") {
      removedCount++;
      return { kind, beforeLine: ++beforeNo, afterLine: null, text };
    }
    return { kind, beforeLine: ++beforeNo, afterLine: ++afterNo, text };
  });

  return {
    hunks: buildHunks(rows, context),
    addedCount,
    removedCount,
    tooLarge: false,
  };
}

/**
 * Changed rows plus `context` lines either side, with overlapping windows
 * merged and everything else dropped.
 *
 * Separate from `diffLines` because hunking is the part of a unified diff
 * that gets quietly wrong at the edges, and it is much easier to test against
 * hand-built rows than against a pair of payloads.
 */
export function buildHunks(
  rows: readonly LineDiffRow[],
  context: number,
): readonly LineDiffHunk[] {
  const windows: { start: number; end: number }[] = [];
  rows.forEach((row, index) => {
    if (row.kind === "context") {
      return;
    }
    const start = Math.max(0, index - context);
    const end = Math.min(rows.length - 1, index + context);
    const last = windows.at(-1);
    // Merged when they touch as well as when they overlap: a single context
    // line between two hunks is noise, not a separator.
    if (last !== undefined && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
      return;
    }
    windows.push({ start, end });
  });

  return windows.map(({ start, end }) => {
    const hunkRows = rows.slice(start, end + 1);
    return { header: hunkHeader(hunkRows), rows: hunkRows };
  });
}

/**
 * How the view shows a line whose whitespace is the point.
 *
 * A stray carriage return is invisible otherwise, which would make a CRLF/LF
 * diff look like two identical lines marked as different.
 */
export function visibleLine(text: string): string {
  return text.replace(/\r/g, "␍");
}

function hunkHeader(rows: readonly LineDiffRow[]): string {
  const beforeRows = rows.filter((row) => row.kind !== "added");
  const afterRows = rows.filter((row) => row.kind !== "removed");
  // Zero start with zero count is the unified-diff convention for "this side
  // contributes nothing here", e.g. inserting into an empty payload.
  const beforeStart = beforeRows[0]?.beforeLine ?? 0;
  const afterStart = afterRows[0]?.afterLine ?? 0;
  return `@@ -${beforeStart},${beforeRows.length} +${afterStart},${afterRows.length} @@`;
}

/**
 * Longest-common-subsequence walk over the two middles.
 *
 * The table holds suffix lengths so the backtrack runs forward, which keeps
 * the rows in order without a reversal pass. Preferring the removal when the
 * two branches tie is what puts `-` before `+` at a change site, the way
 * every other diff does.
 */
function lcsRows(
  before: readonly string[],
  after: readonly string[],
): { kind: LineDiffKind; text: string }[] {
  const n = before.length;
  const m = after.length;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        before[i] === after[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const rows: { kind: LineDiffKind; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      rows.push({ kind: "context", text: before[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      rows.push({ kind: "removed", text: before[i] });
      i++;
    } else {
      rows.push({ kind: "added", text: after[j] });
      j++;
    }
  }
  while (i < n) {
    rows.push({ kind: "removed", text: before[i++] });
  }
  while (j < m) {
    rows.push({ kind: "added", text: after[j++] });
  }
  return rows;
}

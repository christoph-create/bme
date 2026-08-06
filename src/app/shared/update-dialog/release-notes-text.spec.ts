import { describe, expect, it } from "vitest";

import { releaseNotesText } from "./release-notes-text";

const FALLBACK = "No release notes for this version.";

describe("releaseNotesText", () => {
  it("falls back when there are no notes at all", () => {
    expect(releaseNotesText(null)).toBe(FALLBACK);
  });

  it("falls back when the notes are only whitespace", () => {
    expect(releaseNotesText("   \n\n  ")).toBe(FALLBACK);
  });

  it("normalises windows line endings", () => {
    expect(releaseNotesText("first\r\nsecond")).toBe("first\nsecond");
  });

  it("collapses runs of blank lines to one", () => {
    expect(releaseNotesText("first\n\n\n\n\nsecond")).toBe("first\n\nsecond");
  });

  it("keeps a single blank line between paragraphs", () => {
    expect(releaseNotesText("first\n\nsecond")).toBe("first\n\nsecond");
  });

  it("trims surrounding whitespace", () => {
    expect(releaseNotesText("\n  notes  \n")).toBe("notes");
  });
});

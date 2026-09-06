import { describe, expect, it } from "vitest";

import { splitForHighlight } from "./highlight-tokens";

describe("splitForHighlight", () => {
  it("returns the whole text unmatched for an empty query", () => {
    expect(splitForHighlight("hello world", "")).toEqual([
      { text: "hello world", matched: false },
    ]);
  });

  it("returns the whole text unmatched for a whitespace-only query", () => {
    expect(splitForHighlight("hello world", "   ")).toEqual([
      { text: "hello world", matched: false },
    ]);
  });

  it("returns the whole text unmatched when the query never occurs", () => {
    expect(splitForHighlight("hello world", "nope")).toEqual([
      { text: "hello world", matched: false },
    ]);
  });

  it("splits around a single match in the middle", () => {
    expect(splitForHighlight("hello world", "wor")).toEqual([
      { text: "hello ", matched: false },
      { text: "wor", matched: true },
      { text: "ld", matched: false },
    ]);
  });

  it("handles a match at the very start", () => {
    expect(splitForHighlight("hello world", "hello")).toEqual([
      { text: "hello", matched: true },
      { text: " world", matched: false },
    ]);
  });

  it("handles a match at the very end", () => {
    expect(splitForHighlight("hello world", "world")).toEqual([
      { text: "hello ", matched: false },
      { text: "world", matched: true },
    ]);
  });

  it("handles the whole string matching", () => {
    expect(splitForHighlight("hello", "hello")).toEqual([
      { text: "hello", matched: true },
    ]);
  });

  it("matches case-insensitively but preserves original casing in the segment", () => {
    expect(splitForHighlight("Hello World", "world")).toEqual([
      { text: "Hello ", matched: false },
      { text: "World", matched: true },
    ]);
  });

  it("splits around every non-overlapping occurrence", () => {
    expect(splitForHighlight("aXbXc", "X")).toEqual([
      { text: "a", matched: false },
      { text: "X", matched: true },
      { text: "b", matched: false },
      { text: "X", matched: true },
      { text: "c", matched: false },
    ]);
  });

  it("does not double-count overlapping occurrences", () => {
    expect(splitForHighlight("aaaa", "aa")).toEqual([
      { text: "aa", matched: true },
      { text: "aa", matched: true },
    ]);
  });
});

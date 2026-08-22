import { StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import {
  JsonPlaceholderState,
  indentColumn,
  jsonPlaceholderParser,
} from "./json-placeholder-mode";

interface Token {
  readonly text: string;
  readonly style: string | null;
}

/**
 * Runs the tokenizer over one line the way CodeMirror does, and returns every
 * token plus the state left behind. Mirrors the library's own `readToken`,
 * including its insistence that each call advance the stream.
 */
function tokenizeLine(
  line: string,
  state: JsonPlaceholderState = jsonPlaceholderParser.startState!(2),
): { tokens: Token[]; state: JsonPlaceholderState } {
  const stream = new StringStream(line, 2, 2);
  const tokens: Token[] = [];

  while (!stream.eol()) {
    stream.start = stream.pos;
    const style = jsonPlaceholderParser.token(stream, state);
    if (stream.pos <= stream.start) {
      throw new Error(`Tokenizer failed to advance at ${stream.pos}`);
    }
    tokens.push({ text: stream.current(), style });
  }
  return { tokens, state };
}

/** Tokens that carry a colour, i.e. ignoring whitespace. */
function styled(line: string): Token[] {
  return tokenizeLine(line).tokens.filter((token) => token.style !== null);
}

describe("jsonPlaceholderParser", () => {
  it("reads a placeholder as one token, not a pile of braces", () => {
    expect(styled("{{counter}}")).toEqual([
      { text: "{{counter}}", style: "placeholder" },
    ]);
  });

  it("leaves bracket depth alone across a placeholder", () => {
    // The regression that broke indentation: `{{` counted as two opening
    // braces pushes every following line two levels too deep.
    const state = jsonPlaceholderParser.startState!(2);
    tokenizeLine('  "data1": {{counter}},', state);

    expect(state.depth).toBe(0);
  });

  it("tracks bracket depth through objects and arrays", () => {
    const state = jsonPlaceholderParser.startState!(2);

    tokenizeLine("{", state);
    expect(state.depth).toBe(1);
    tokenizeLine('  "a": [', state);
    expect(state.depth).toBe(2);
    tokenizeLine("  ]", state);
    expect(state.depth).toBe(1);
    tokenizeLine("}", state);
    expect(state.depth).toBe(0);
  });

  it("floors depth at zero, so a stray closer can't go negative", () => {
    const state = jsonPlaceholderParser.startState!(2);
    tokenizeLine("}}}", state);

    expect(state.depth).toBe(0);
  });

  it("colours a string followed by a colon as a key", () => {
    expect(styled('"data1":')).toEqual([
      { text: '"data1"', style: "propertyName" },
      { text: ":", style: "punctuation" },
    ]);
  });

  it("colours a string with no colon after it as a string", () => {
    expect(styled('"data1"')).toEqual([{ text: '"data1"', style: "string" }]);
  });

  it("colours every key the same, placeholders in between or not", () => {
    // The reported symptom exactly: three identical keys came out three
    // different colours because the parse never recovered from the first
    // placeholder. A stream tokenizer has no state to lose.
    const state = jsonPlaceholderParser.startState!(2);
    const keys: (string | null)[] = [];

    tokenizeLine("{", state);
    for (const name of ["data1", "data2", "data3"]) {
      const { tokens } = tokenizeLine(`  "${name}": {{counter}},`, state);
      keys.push(tokens.find((t) => t.text === `"${name}"`)?.style ?? null);
    }

    expect(keys).toEqual(["propertyName", "propertyName", "propertyName"]);
  });

  it("colours numbers, booleans and null", () => {
    const styles = styled("[1, -2.5, 1e3, true, false, null]")
      .filter((token) => token.style !== "punctuation")
      .map((token) => token.style);

    expect(styles).toEqual([
      "number",
      "number",
      "number",
      "bool",
      "bool",
      "null",
    ]);
  });

  it("colours brackets, commas and colons as punctuation", () => {
    const styles = styled('{"a": [1]}')
      .filter((token) => token.style === "punctuation")
      .map((token) => token.text);

    expect(styles).toEqual(["{", ":", "[", "]", "}"]);
  });

  it("colours an unterminated string without looping forever", () => {
    expect(styled('{"a": "unterminated')).toEqual([
      { text: "{", style: "punctuation" },
      { text: '"a"', style: "propertyName" },
      { text: ":", style: "punctuation" },
      { text: '"unterminated', style: "string" },
    ]);
  });

  it("advances past characters it can't classify", () => {
    // A zero-length token makes CodeMirror throw, so the fallback branch has
    // to consume something even when it returns no style.
    expect(tokenizeLine("@#$").tokens).toEqual([
      { text: "@", style: null },
      { text: "#", style: null },
      { text: "$", style: null },
    ]);
  });

  it("emits only tag names CodeMirror knows", () => {
    // Token names are plain strings: a typo like "boolean" for "bool" only
    // shows up as a console warning and a silently uncoloured token.
    const known = new Set([
      ...Object.keys(tags),
      ...Object.keys(jsonPlaceholderParser.tokenTable ?? {}),
    ]);
    const emitted = styled(
      '{"a": [1, true, null, "s", {{v}}], "b": 2}',
    ).map((token) => token.style);

    expect(emitted.length).toBeGreaterThan(0);
    for (const style of emitted) {
      expect(known).toContain(style);
    }
  });
});

describe("indentColumn", () => {
  it("indents one unit per open bracket", () => {
    expect(indentColumn(0, '"a": 1', 2)).toBe(0);
    expect(indentColumn(1, '"a": 1', 2)).toBe(2);
    expect(indentColumn(3, '"a": 1', 2)).toBe(6);
  });

  it("pulls a line that starts with a closing bracket out one level", () => {
    expect(indentColumn(1, "}", 2)).toBe(0);
    expect(indentColumn(2, "]", 2)).toBe(2);
  });

  it("never goes negative", () => {
    expect(indentColumn(0, "}", 2)).toBe(0);
  });
});

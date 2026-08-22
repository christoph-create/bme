import {
  IndentContext,
  StreamLanguage,
  StreamParser,
  StringStream,
} from "@codemirror/language";
import { Tag } from "@lezer/highlight";

import { PLACEHOLDER_PATTERN } from "../../core/variables/placeholders";

/**
 * A CodeMirror mode for "JSON, plus `{{name}}` placeholders".
 *
 * `@codemirror/lang-json` can't parse a placeholder - its Lezer grammar hits
 * `{{` where a value belongs, and error recovery then mis-tags everything that
 * follows, so keys after the first placeholder stop being coloured as keys.
 * The same broken parse feeds the indent service, which is why Enter stops
 * indenting. A stream tokenizer has neither problem: it never fails, it just
 * classifies the next run of characters, and its `indent` is ours to define.
 */

/** Placeholders get their own tag rather than borrowing one: a placeholder is
 * neither a string nor a number, and colouring it as whichever it happens to
 * sit next to is the bug this mode exists to fix. */
export const placeholderTag = Tag.define("payloadPlaceholder");

export interface JsonPlaceholderState {
  /** Bracket nesting at this point in the document, floored at zero so an
   * unbalanced `}` mid-edit can't push later lines to negative indentation. */
  depth: number;
}

/** Anchored, non-global forms - `StringStream.match` needs a pattern that can
 * only match at the current position. The placeholder grammar itself comes
 * from `placeholders.ts` so it stays defined once. */
const PLACEHOLDER_HERE = new RegExp(`^${PLACEHOLDER_PATTERN.source}`);
/** Same shape as `JsonFormatService`'s number rule, so the editor and the
 * read-only view agree on what counts as a number. */
const NUMBER_HERE = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const BOOLEAN_HERE = /^(?:true|false)\b/;
const NULL_HERE = /^null\b/;
const FOLLOWED_BY_COLON = /^\s*:/;

/** Indentation for a line sitting at `depth`. A line that *starts* with a
 * closing bracket belongs to the enclosing level, not the one it closes. */
export function indentColumn(
  depth: number,
  textAfter: string,
  unit: number,
): number {
  const closesItsOwnLevel = /^[}\]]/.test(textAfter);
  return Math.max(0, depth - (closesItsOwnLevel ? 1 : 0)) * unit;
}

/** Consumes a string literal from the opening quote. Returns whether it was
 * terminated on this line - an unterminated one still colours as a string,
 * which is what you want mid-typing. */
function consumeString(stream: StringStream): boolean {
  stream.next();
  let escaped = false;
  while (!stream.eol()) {
    const ch = stream.next();
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === '"') {
      return true;
    }
  }
  return false;
}

/** Exported separately from the `StreamLanguage` below, which is opaque, so
 * the tokenizer can be driven directly in tests. */
export const jsonPlaceholderParser: StreamParser<JsonPlaceholderState> = {
  name: "json-with-placeholders",

  startState: () => ({ depth: 0 }),
  copyState: (state) => ({ depth: state.depth }),

  token(stream, state) {
    if (stream.eatSpace()) {
      return null;
    }

    // Must come before the bracket branch below. Read as two opening braces,
    // `{{` would push depth by two and `}}` pop it by two, so every line after
    // a placeholder indents from the wrong level - the exact bug being fixed.
    if (stream.match(PLACEHOLDER_HERE)) {
      return "placeholder";
    }

    if (stream.peek() === '"') {
      // A key is a string with a colon after it. The lookahead is line-local,
      // since that's all a StringStream can see, so `"key"\n: 1` colours as a
      // string - which pretty-printed JSON never produces.
      const terminated = consumeString(stream);
      return terminated && stream.match(FOLLOWED_BY_COLON, false)
        ? "propertyName"
        : "string";
    }

    if (stream.match(NUMBER_HERE)) {
      return "number";
    }
    if (stream.match(BOOLEAN_HERE)) {
      return "bool";
    }
    if (stream.match(NULL_HERE)) {
      return "null";
    }

    const ch = stream.next();
    if (ch === "{" || ch === "[") {
      state.depth++;
      return "punctuation";
    }
    if (ch === "}" || ch === "]") {
      state.depth = Math.max(0, state.depth - 1);
      return "punctuation";
    }
    if (ch === "," || ch === ":") {
      return "punctuation";
    }
    // Anything else is left uncoloured, matching the read-only view's `plain`.
    // `stream.next()` above already advanced; a zero-length token would throw.
    return null;
  },

  indent: (state, textAfter, cx: IndentContext) =>
    indentColumn(state.depth, textAfter, cx.unit),

  // Without this, `indentOnInput()` has no pattern to test and is inert.
  languageData: { indentOnInput: /^\s*[}\]]$/ },

  tokenTable: { placeholder: placeholderTag },
};

export const jsonWithPlaceholders = StreamLanguage.define(
  jsonPlaceholderParser,
);

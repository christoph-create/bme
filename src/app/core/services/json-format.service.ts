import { Injectable } from "@angular/core";

export type JsonTokenKind =
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punctuation"
  | "whitespace"
  | "plain";

export interface JsonToken {
  readonly kind: JsonTokenKind;
  readonly text: string;
}

export type JsonFormatResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

const TOKEN_PATTERN =
  /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]|\s+/g;

/**
 * Single source of truth for JSON parsing/formatting/tokenizing, shared by
 * every place a payload is displayed or edited - see
 * docs/plans/json_rework.md.
 */
@Injectable({ providedIn: "root" })
export class JsonFormatService {
  /** Pretty-prints with 2-space indentation, reporting failure explicitly -
   * for editable inputs, which need to show an error instead of silently
   * leaving the text unchanged. */
  format(text: string): JsonFormatResult {
    try {
      return { ok: true, value: JSON.stringify(JSON.parse(text), null, 2) };
    } catch {
      return { ok: false, error: "Payload isn't valid JSON" };
    }
  }

  /** Best-effort pretty-print: the input unchanged if it isn't valid JSON.
   * For read-only display, where there's no error to show. */
  tryFormat(text: string): string {
    const result = this.format(text);
    return result.ok ? result.value : text;
  }

  /** Minifies (no indentation) for wire encoding - falls back to the raw
   * text unchanged if it isn't valid JSON. */
  compact(text: string): string {
    try {
      return JSON.stringify(JSON.parse(text));
    } catch {
      return text;
    }
  }

  /**
   * Tokenizes `text` for syntax highlighting. Best-effort and independent
   * of overall validity: it scans token-by-token (strings, numbers,
   * keywords, punctuation) so incomplete or invalid JSON - e.g. mid-edit -
   * still highlights as far as it can, instead of falling back to a single
   * unstyled blob. Concatenating every token's `text` always reconstructs
   * the original input exactly, so no input characters are ever dropped.
   */
  tokenize(text: string): readonly JsonToken[] {
    const tokens: JsonToken[] = [];
    let lastIndex = 0;
    const pattern = new RegExp(TOKEN_PATTERN);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        tokens.push({ kind: "plain", text: text.slice(lastIndex, match.index) });
      }
      const raw = match[0];
      tokens.push({ kind: classifyToken(raw, text, pattern.lastIndex), text: raw });
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < text.length) {
      tokens.push({ kind: "plain", text: text.slice(lastIndex) });
    }
    return tokens;
  }
}

function classifyToken(
  raw: string,
  fullText: string,
  endIndex: number,
): JsonTokenKind {
  if (raw[0] === '"') {
    return isObjectKey(fullText, endIndex) ? "key" : "string";
  }
  if (raw === "true" || raw === "false") {
    return "boolean";
  }
  if (raw === "null") {
    return "null";
  }
  if (/^\s+$/.test(raw)) {
    return "whitespace";
  }
  if (raw.length === 1 && "{}[],:".includes(raw)) {
    return "punctuation";
  }
  return "number";
}

/** A string token is an object key when the next non-whitespace character
 * after it is a colon. */
function isObjectKey(text: string, afterIndex: number): boolean {
  let i = afterIndex;
  while (i < text.length && /\s/.test(text[i])) {
    i++;
  }
  return text[i] === ":";
}

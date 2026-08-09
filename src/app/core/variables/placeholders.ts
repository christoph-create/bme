/**
 * Scanning and substitution for `{{name}}` placeholders in a topic or payload.
 *
 * Deliberately knows nothing about variables, generators or JSON - it takes a
 * resolver and calls it. The three consumers (real expansion, the validation
 * probe in `probe-expand.ts`, and the unknown-name warning) then differ only
 * in what they resolve a name to.
 */

export interface PlaceholderRef {
  readonly name: string;
  /** Index of the opening `{`. */
  readonly start: number;
  /** Index one past the closing `}`. */
  readonly end: number;
}

/**
 * Names are identifier-shaped: a letter or underscore, then letters, digits or
 * underscores. Restrictive on purpose - anything looser starts colliding with
 * payloads that legitimately contain braces (Jinja, Handlebars, shell
 * interpolation), and those should pass through untouched.
 *
 * Surrounding whitespace is tolerated so `{{ uuid }}` works, since that's what
 * people type.
 */
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** True when `name` is usable as a placeholder name at all - what the
 * variables editor validates against, so a saved variable is always
 * referenceable. */
export function isValidVariableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function findPlaceholders(text: string): PlaceholderRef[] {
  const found: PlaceholderRef[] = [];
  const pattern = new RegExp(PLACEHOLDER_PATTERN);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    found.push({
      name: match[1],
      start: match.index,
      end: pattern.lastIndex,
    });
  }
  return found;
}

/** Cheap check for "is any of this machinery relevant to this text at all" -
 * used to keep the preview line and the expansion path off the hot path for
 * ordinary payloads. */
export function hasPlaceholders(text: string): boolean {
  return findPlaceholders(text).length > 0;
}

/**
 * Replaces every placeholder with what `resolve` returns for its name.
 *
 * A `null` from `resolve` means "no such variable", and the placeholder is
 * left exactly as written. That's the deliberate choice for unknown names: a
 * payload may contain braces for reasons that have nothing to do with bme, and
 * silently blanking those would corrupt a message the user meant to send.
 */
export function replacePlaceholders(
  text: string,
  resolve: (name: string) => string | null,
): string {
  const refs = findPlaceholders(text);
  if (refs.length === 0) {
    return text;
  }

  let result = "";
  let cursor = 0;
  for (const ref of refs) {
    const value = resolve(ref.name);
    result += text.slice(cursor, ref.start) + (value ?? text.slice(ref.start, ref.end));
    cursor = ref.end;
  }
  return result + text.slice(cursor);
}

/** Distinct placeholder names in `text` that aren't in `known`, in the order
 * they first appear. Drives the preview's "unknown variable" warning. */
export function unknownPlaceholderNames(
  text: string,
  known: ReadonlySet<string>,
): string[] {
  const unknown: string[] = [];
  for (const { name } of findPlaceholders(text)) {
    if (!known.has(name) && !unknown.includes(name)) {
      unknown.push(name);
    }
  }
  return unknown;
}

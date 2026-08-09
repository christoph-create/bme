/** Mirrors `core::models::TimestampFormat`. */
export type TimestampFormat = "unixMillis" | "iso8601";

/**
 * Mirrors `core::models::VariableGenerator` - an internally tagged enum, so
 * the discriminant is `kind` and the parameters sit alongside it.
 *
 * Every generator is fully parameterised here, which is what lets the
 * reference syntax stay a bare `{{name}}` with no call arguments to parse.
 */
export type VariableGenerator =
  | { kind: "fixedText"; value: string }
  | { kind: "counter"; start: number; step: number }
  | { kind: "randomInt"; min: number; max: number }
  | { kind: "randomFloat"; min: number; max: number; decimals: number }
  | { kind: "uuid" }
  | { kind: "timestamp"; format: TimestampFormat };

export type VariableGeneratorKind = VariableGenerator["kind"];

/** Mirrors `core::models::PayloadVariable`. */
export interface PayloadVariable {
  id: string;
  name: string;
  generator: VariableGenerator;
  created_at: string;
}

/** Mirrors `core::models::NewPayloadVariable`. */
export interface NewPayloadVariable {
  name: string;
  generator: VariableGenerator;
}

/** Mirrors `core::models::UpdatePayloadVariable`. */
export interface UpdatePayloadVariable {
  name: string;
  generator: VariableGenerator;
}

/**
 * What an expanded value looks like *in JSON terms*, independent of the
 * actual value. This is the whole basis of placeholder-aware JSON validation:
 * whether `{"t":{{tempC}}}` parses depends only on `tempC` being numeric, not
 * on which number it happens to produce this time. See `probe-expand.ts`.
 */
export type VariableValueKind = "string" | "number";

export function valueKindOf(generator: VariableGenerator): VariableValueKind {
  switch (generator.kind) {
    case "counter":
    case "randomInt":
    case "randomFloat":
      return "number";
    case "timestamp":
      return generator.format === "unixMillis" ? "number" : "string";
    default:
      return "string";
  }
}

/** Human-readable generator name, for the variables table and insert menu. */
export function generatorLabel(generator: VariableGenerator): string {
  switch (generator.kind) {
    case "fixedText":
      return "Fixed text";
    case "counter":
      return "Counter";
    case "randomInt":
      return "Random int";
    case "randomFloat":
      return "Random float";
    case "uuid":
      return "UUID";
    case "timestamp":
      return "Timestamp";
  }
}

/** Display name for a generator *kind*, for the type dropdown - which has a
 * kind to label but no configured generator yet. */
export function generatorKindLabel(kind: VariableGeneratorKind): string {
  return generatorLabel(defaultGenerator(kind));
}

/** One-line summary of a generator's parameters, for the same two places. */
export function generatorSummary(generator: VariableGenerator): string {
  switch (generator.kind) {
    case "fixedText":
      return generator.value;
    case "counter":
      return `start ${generator.start}, step ${generator.step}`;
    case "randomInt":
      return `${generator.min} – ${generator.max}`;
    case "randomFloat":
      return `${generator.min} – ${generator.max}, ${generator.decimals} dp`;
    case "uuid":
      return "";
    case "timestamp":
      return generator.format === "unixMillis" ? "unix ms" : "ISO 8601";
  }
}

/** The generator a newly added variable starts as. */
export function defaultGenerator(
  kind: VariableGeneratorKind,
): VariableGenerator {
  switch (kind) {
    case "fixedText":
      return { kind: "fixedText", value: "" };
    case "counter":
      return { kind: "counter", start: 1, step: 1 };
    case "randomInt":
      return { kind: "randomInt", min: 0, max: 100 };
    case "randomFloat":
      return { kind: "randomFloat", min: 0, max: 1, decimals: 2 };
    case "uuid":
      return { kind: "uuid" };
    case "timestamp":
      return { kind: "timestamp", format: "unixMillis" };
  }
}

export const GENERATOR_KINDS: readonly VariableGeneratorKind[] = [
  "fixedText",
  "counter",
  "randomInt",
  "randomFloat",
  "uuid",
  "timestamp",
];

/** True for generators that carry state across sends - i.e. the ones the
 * "counters restart when a run starts" rule applies to. */
export function isStateful(generator: VariableGenerator): boolean {
  return generator.kind === "counter";
}

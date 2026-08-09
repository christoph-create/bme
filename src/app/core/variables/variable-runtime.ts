import {
  PayloadVariable,
  VariableGenerator,
} from "../models/payload-variable.model";

/**
 * The clock and the randomness, as parameters rather than direct calls to
 * `Date.now()`/`Math.random()`.
 *
 * Same reasoning as `now` being an argument in `core/src/update/checker.rs`:
 * every generator is then deterministically testable, which for a feature
 * whose entire job is producing varying values is the difference between
 * testing it and asserting it doesn't throw.
 */
export interface RuntimeDeps {
  now(): number;
  random(): number;
}

export const SYSTEM_RUNTIME_DEPS: RuntimeDeps = {
  now: () => Date.now(),
  random: () => Math.random(),
};

/** `toFixed` accepts 0-100; this is the range that's actually meaningful for
 * a sensor reading, and it keeps the variables editor's input bounded. */
const MAX_DECIMALS = 10;

/**
 * Produces values for `{{placeholder}}` expansion, and owns the only piece of
 * state involved: where each counter has got to.
 *
 * Counters are keyed by variable id rather than name, so renaming a variable
 * mid-session doesn't silently restart its sequence.
 */
export class VariableRuntime {
  private readonly counters = new Map<string, number>();

  constructor(private readonly deps: RuntimeDeps = SYSTEM_RUNTIME_DEPS) {}

  /** Restarts every counter from its configured `start`. Called when a repeat
   * run begins, so a run's sequence always reads 1, 2, 3… */
  reset(): void {
    this.counters.clear();
  }

  /** Restarts one counter, leaving the others where they are. */
  resetOne(id: string): void {
    this.counters.delete(id);
  }

  /** The next value for `variable`, advancing any state it carries. */
  next(variable: PayloadVariable): string {
    return this.generate(variable.id, variable.generator, true);
  }

  /**
   * What `next` *would* return, without advancing anything.
   *
   * This is what the preview needs: it re-runs on every keystroke, and if it
   * consumed counter values the sequence a real publish sends would depend on
   * how much you typed. Peeking also means the preview tracks a live run -
   * mid-run it shows the value the next message will actually carry, not the
   * counter's start.
   *
   * Random and timestamp generators have no state to preserve, so peeking
   * them simply draws a fresh sample - which is the honest preview for a
   * value that is different every time anyway.
   */
  peek(variable: PayloadVariable): string {
    return this.generate(variable.id, variable.generator, false);
  }

  /** The counter values currently in flight, by variable id - so the settings
   * layer can show where a sequence has got to. */
  counterState(): ReadonlyMap<string, number> {
    return new Map(this.counters);
  }

  /**
   * A `replacePlaceholders` resolver over `variables`: known names produce a
   * fresh value, unknown ones return `null` and are left literal.
   *
   * Built per expansion so one publish is one consistent view of the
   * definitions, even if the variables list changes underneath.
   */
  resolver(
    variables: readonly PayloadVariable[],
  ): (name: string) => string | null {
    const byName = new Map(variables.map((v) => [v.name, v]));
    return (name) => {
      const variable = byName.get(name);
      return variable ? this.next(variable) : null;
    };
  }

  /** Like `resolver`, but non-consuming - for the preview. */
  peekResolver(
    variables: readonly PayloadVariable[],
  ): (name: string) => string | null {
    const byName = new Map(variables.map((v) => [v.name, v]));
    return (name) => {
      const variable = byName.get(name);
      return variable ? this.peek(variable) : null;
    };
  }

  private generate(
    id: string,
    generator: VariableGenerator,
    advance: boolean,
  ): string {
    switch (generator.kind) {
      case "fixedText":
        return generator.value;

      case "counter": {
        const current = this.counters.get(id) ?? generator.start;
        if (advance) {
          this.counters.set(id, current + generator.step);
        }
        return String(current);
      }

      case "randomInt": {
        const [lo, hi] = orderedRange(generator.min, generator.max);
        const first = Math.ceil(lo);
        const last = Math.floor(hi);
        // A range like 1.2-1.8 contains no integer at all; rounding the low
        // bound is more useful than producing NaN.
        if (last < first) {
          return String(Math.round(lo));
        }
        return String(first + this.randomIndex(last - first + 1));
      }

      case "randomFloat": {
        const [lo, hi] = orderedRange(generator.min, generator.max);
        const decimals = clamp(Math.trunc(generator.decimals), 0, MAX_DECIMALS);
        return (lo + this.deps.random() * (hi - lo)).toFixed(decimals);
      }

      case "uuid":
        return this.uuid();

      case "timestamp": {
        const millis = Math.trunc(this.deps.now());
        return generator.format === "unixMillis"
          ? String(millis)
          : new Date(millis).toISOString();
      }
    }
  }

  /** A v4 UUID built from the injected randomness rather than
   * `crypto.randomUUID()`. Two reasons: it stays deterministic under test, and
   * `randomUUID` needs a secure context, which is not something a payload
   * generator should depend on. These are test-message ids, not secrets. */
  private uuid(): string {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = this.randomIndex(256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  /** `0 <= result < size`, clamped so a `random()` of exactly 1 - which the
   * contract allows an injected fake to return - can't land out of range. */
  private randomIndex(size: number): number {
    return Math.min(size - 1, Math.floor(this.deps.random() * size));
  }
}

function orderedRange(a: number, b: number): [number, number] {
  const lo = Number.isFinite(a) ? a : 0;
  const hi = Number.isFinite(b) ? b : 0;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

import { describe, expect, it } from "vitest";

import {
  PayloadVariable,
  VariableGenerator,
} from "../models/payload-variable.model";
import { RuntimeDeps, VariableRuntime } from "./variable-runtime";

/** Replays `values` for successive `random()` calls, then repeats the last
 * one - so a test only has to state the draws it cares about. */
function deps(options: {
  now?: number;
  random?: readonly number[];
}): RuntimeDeps {
  const draws = options.random ?? [0];
  let index = 0;
  return {
    now: () => options.now ?? 0,
    random: () => draws[Math.min(index++, draws.length - 1)],
  };
}

function variable(
  generator: VariableGenerator,
  id = "id-1",
  name = "v",
): PayloadVariable {
  return { id, name, generator, created_at: "2026-01-01T00:00:00Z" };
}

describe("VariableRuntime fixed text", () => {
  it("returns the configured value verbatim", () => {
    const runtime = new VariableRuntime(deps({}));

    expect(
      runtime.next(variable({ kind: "fixedText", value: "dev-42" })),
    ).toBe("dev-42");
  });

  it("allows an empty value", () => {
    const runtime = new VariableRuntime(deps({}));

    expect(runtime.next(variable({ kind: "fixedText", value: "" }))).toBe("");
  });
});

describe("VariableRuntime counter", () => {
  it("starts at the configured start and advances by step", () => {
    const runtime = new VariableRuntime(deps({}));
    const counter = variable({ kind: "counter", start: 1, step: 1 });

    const values = [1, 2, 3].map(() => runtime.next(counter));

    expect(values).toEqual(["1", "2", "3"]);
  });

  it("honours a start and step other than one", () => {
    const runtime = new VariableRuntime(deps({}));
    const counter = variable({ kind: "counter", start: 100, step: 5 });

    expect([runtime.next(counter), runtime.next(counter)]).toEqual([
      "100",
      "105",
    ]);
  });

  it("counts down for a negative step", () => {
    const runtime = new VariableRuntime(deps({}));
    const counter = variable({ kind: "counter", start: 3, step: -1 });

    expect([runtime.next(counter), runtime.next(counter)]).toEqual(["3", "2"]);
  });

  it("keeps separate counters per variable", () => {
    const runtime = new VariableRuntime(deps({}));
    const first = variable({ kind: "counter", start: 1, step: 1 }, "a");
    const second = variable({ kind: "counter", start: 10, step: 1 }, "b");

    runtime.next(first);
    runtime.next(first);

    expect(runtime.next(second)).toBe("10");
    expect(runtime.next(first)).toBe("3");
  });

  it("restarts from the beginning after reset", () => {
    const runtime = new VariableRuntime(deps({}));
    const counter = variable({ kind: "counter", start: 1, step: 1 });
    runtime.next(counter);
    runtime.next(counter);

    runtime.reset();

    expect(runtime.next(counter)).toBe("1");
  });

  it("tracks a counter by id, so renaming does not restart it", () => {
    const runtime = new VariableRuntime(deps({}));
    const before = variable({ kind: "counter", start: 1, step: 1 }, "a", "seq");
    runtime.next(before);

    const renamed = variable({ kind: "counter", start: 1, step: 1 }, "a", "n");

    expect(runtime.next(renamed)).toBe("2");
  });
});

describe("VariableRuntime randomInt", () => {
  it("returns the low bound for a draw of zero", () => {
    const runtime = new VariableRuntime(deps({ random: [0] }));

    expect(runtime.next(variable({ kind: "randomInt", min: 5, max: 10 }))).toBe(
      "5",
    );
  });

  it("returns the high bound for a draw at the top of the range", () => {
    const runtime = new VariableRuntime(deps({ random: [0.999999] }));

    expect(runtime.next(variable({ kind: "randomInt", min: 5, max: 10 }))).toBe(
      "10",
    );
  });

  it("stays inside the range even for a draw of exactly one", () => {
    // Math.random() never returns 1, but an injected fake can, and landing on
    // max+1 would be an off-by-one that only shows up in production.
    const runtime = new VariableRuntime(deps({ random: [1] }));

    expect(runtime.next(variable({ kind: "randomInt", min: 5, max: 10 }))).toBe(
      "10",
    );
  });

  it("handles reversed bounds by ordering them", () => {
    const runtime = new VariableRuntime(deps({ random: [0] }));

    expect(runtime.next(variable({ kind: "randomInt", min: 10, max: 5 }))).toBe(
      "5",
    );
  });

  it("produces the single value of a zero-width range", () => {
    const runtime = new VariableRuntime(deps({ random: [0.7] }));

    expect(runtime.next(variable({ kind: "randomInt", min: 7, max: 7 }))).toBe(
      "7",
    );
  });

  it("rounds a fractional range that contains no integer", () => {
    const runtime = new VariableRuntime(deps({ random: [0.5] }));

    expect(
      runtime.next(variable({ kind: "randomInt", min: 1.2, max: 1.8 })),
    ).toBe("1");
  });

  it("handles negative ranges", () => {
    const runtime = new VariableRuntime(deps({ random: [0] }));

    expect(
      runtime.next(variable({ kind: "randomInt", min: -10, max: -5 })),
    ).toBe("-10");
  });
});

describe("VariableRuntime randomFloat", () => {
  it("interpolates the range and formats to the configured decimals", () => {
    const runtime = new VariableRuntime(deps({ random: [0.5] }));

    expect(
      runtime.next(
        variable({ kind: "randomFloat", min: 18, max: 24, decimals: 1 }),
      ),
    ).toBe("21.0");
  });

  it("always emits the requested number of decimals, so JSON stays stable", () => {
    const runtime = new VariableRuntime(deps({ random: [0] }));

    expect(
      runtime.next(
        variable({ kind: "randomFloat", min: 1, max: 2, decimals: 3 }),
      ),
    ).toBe("1.000");
  });

  it("emits a bare integer for zero decimals", () => {
    const runtime = new VariableRuntime(deps({ random: [0.5] }));

    expect(
      runtime.next(
        variable({ kind: "randomFloat", min: 0, max: 10, decimals: 0 }),
      ),
    ).toBe("5");
  });

  it("clamps an out-of-range decimals rather than throwing", () => {
    // toFixed throws a RangeError past 100, and a config that came from an
    // edited database shouldn't be able to take the publish path down.
    const runtime = new VariableRuntime(deps({ random: [0] }));

    expect(
      runtime.next(
        variable({ kind: "randomFloat", min: 0, max: 1, decimals: 999 }),
      ),
    ).toBe("0.0000000000");
  });

  it("produces a value parseable as a JSON number", () => {
    const runtime = new VariableRuntime(deps({ random: [0.25] }));

    const value = runtime.next(
      variable({ kind: "randomFloat", min: -5, max: 5, decimals: 2 }),
    );

    expect(JSON.parse(value)).toBeCloseTo(-2.5);
  });
});

describe("VariableRuntime uuid", () => {
  it("produces a well-formed v4 UUID", () => {
    const runtime = new VariableRuntime(deps({ random: [0.5] }));

    const value = runtime.next(variable({ kind: "uuid" }));

    expect(value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("stays well-formed at both extremes of the random range", () => {
    for (const draw of [0, 1]) {
      const runtime = new VariableRuntime(deps({ random: [draw] }));

      expect(runtime.next(variable({ kind: "uuid" }))).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("produces a different value per call when the draws differ", () => {
    const runtime = new VariableRuntime(deps({ random: [0.1, 0.9] }));
    const uuid = variable({ kind: "uuid" });

    expect(runtime.next(uuid)).not.toBe(runtime.next(uuid));
  });
});

describe("VariableRuntime timestamp", () => {
  it("emits unix milliseconds as a bare number", () => {
    const runtime = new VariableRuntime(deps({ now: 1_767_225_600_000 }));

    expect(
      runtime.next(variable({ kind: "timestamp", format: "unixMillis" })),
    ).toBe("1767225600000");
  });

  it("emits ISO 8601 for the same instant", () => {
    const runtime = new VariableRuntime(deps({ now: 1_767_225_600_000 }));

    expect(
      runtime.next(variable({ kind: "timestamp", format: "iso8601" })),
    ).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("VariableRuntime resolver", () => {
  it("resolves known names and leaves unknown ones to the caller", () => {
    const runtime = new VariableRuntime(deps({}));
    const resolve = runtime.resolver([
      variable({ kind: "fixedText", value: "dev-42" }, "a", "deviceId"),
    ]);

    expect(resolve("deviceId")).toBe("dev-42");
    expect(resolve("typo")).toBeNull();
  });

  it("advances state across resolutions", () => {
    const runtime = new VariableRuntime(deps({}));
    const resolve = runtime.resolver([
      variable({ kind: "counter", start: 1, step: 1 }, "a", "seq"),
    ]);

    expect([resolve("seq"), resolve("seq")]).toEqual(["1", "2"]);
  });

  it("is case sensitive, matching the placeholder syntax", () => {
    const runtime = new VariableRuntime(deps({}));
    const resolve = runtime.resolver([
      variable({ kind: "fixedText", value: "x" }, "a", "deviceId"),
    ]);

    expect(resolve("deviceid")).toBeNull();
  });
});

describe("VariableRuntime peek", () => {
  it("returns what next would, without consuming it", () => {
    const runtime = new VariableRuntime(deps({}));
    const counter = variable({ kind: "counter", start: 1, step: 1 });

    expect(runtime.peek(counter)).toBe("1");
    expect(runtime.peek(counter)).toBe("1");
    expect(runtime.next(counter)).toBe("1");
  });

  it("tracks a counter that has already advanced", () => {
    // The preview is peeking mid-run; showing the start value there would be
    // a lie about what the next message carries.
    const runtime = new VariableRuntime(deps({}));
    const counter = variable({ kind: "counter", start: 1, step: 1 });
    runtime.next(counter);
    runtime.next(counter);

    expect(runtime.peek(counter)).toBe("3");
  });

  it("goes back to the start after a reset", () => {
    const runtime = new VariableRuntime(deps({}));
    const counter = variable({ kind: "counter", start: 5, step: 1 });
    runtime.next(counter);

    runtime.reset();

    expect(runtime.peek(counter)).toBe("5");
  });

  it("still produces a value for stateless generators", () => {
    const runtime = new VariableRuntime(deps({ random: [0], now: 42 }));

    expect(runtime.peek(variable({ kind: "randomInt", min: 5, max: 9 }))).toBe("5");
    expect(
      runtime.peek(variable({ kind: "timestamp", format: "unixMillis" })),
    ).toBe("42");
  });

  it("exposes counter positions for the settings readout", () => {
    const runtime = new VariableRuntime(deps({}));
    const counter = variable({ kind: "counter", start: 1, step: 2 }, "id-seq");
    runtime.next(counter);

    expect([...runtime.counterState()]).toEqual([["id-seq", 3]]);
  });

  it("reports no counter state before anything has been generated", () => {
    expect([...new VariableRuntime(deps({})).counterState()]).toEqual([]);
  });
});

describe("VariableRuntime peekResolver", () => {
  it("resolves without advancing", () => {
    const runtime = new VariableRuntime(deps({}));
    const variables = [
      variable({ kind: "counter", start: 1, step: 1 }, "a", "seq"),
    ];
    const peek = runtime.peekResolver(variables);

    expect([peek("seq"), peek("seq")]).toEqual(["1", "1"]);
    expect(runtime.resolver(variables)("seq")).toBe("1");
  });

  it("leaves unknown names to the caller, like resolver does", () => {
    expect(new VariableRuntime(deps({})).peekResolver([])("typo")).toBeNull();
  });
});

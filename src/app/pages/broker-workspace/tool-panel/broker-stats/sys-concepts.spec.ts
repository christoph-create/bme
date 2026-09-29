import { describe, expect, it } from "vitest";

import { SYS_CONCEPTS, matchConcepts } from "./sys-concepts";

function matchedBy(paths: string[]): Record<string, string> {
  const matched = matchConcepts(new Set(paths));
  return Object.fromEntries(
    [...matched].map(([concept, spelling]) => [concept.id, spelling]),
  );
}

describe("the concept table", () => {
  it("has no duplicate ids", () => {
    const ids = SYS_CONCEPTS.map((concept) => concept.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /** Two concepts claiming one spelling would make which tile you get depend
   * on table order, which is not a decision anyone would find later. */
  it("never claims the same spelling twice", () => {
    const spellings = SYS_CONCEPTS.flatMap((concept) => concept.spellings);
    expect(new Set(spellings).size).toBe(spellings.length);
  });

  /** These are normalised paths, so anything with scaffolding in it would
   * silently never match. */
  it("holds normalised paths, not raw topics", () => {
    for (const spelling of SYS_CONCEPTS.flatMap((c) => c.spellings)) {
      expect(spelling).not.toContain("$SYS");
      expect(spelling).toBe(spelling.toLowerCase());
      expect(spelling.split("/")).not.toContain("broker");
    }
  });
});

describe("matchConcepts", () => {
  it("matches what a broker publishes and ignores what it doesn't", () => {
    expect(matchedBy(["uptime", "version"])).toEqual({
      uptime: "uptime",
      version: "version",
    });
  });

  /** EMQX publishes both `subscriptions` and `subscribers`; one tile, and
   * predictably the same one every time. */
  it("takes the first spelling in preference order", () => {
    expect(matchedBy(["subscribers", "subscriptions"])["subscriptions"]).toBe(
      "subscriptions",
    );
    expect(matchedBy(["subscribers"])["subscriptions"]).toBe("subscribers");
  });

  /** mosquitto counts `clients/connected`, EMQX counts `connections` - the
   * same tile either way, which is the whole point of the table. */
  it("reaches one concept from either broker's vocabulary", () => {
    expect(matchedBy(["clients/connected"])["clientsConnected"]).toBe(
      "clients/connected",
    );
    expect(matchedBy(["connections"])["clientsConnected"]).toBe("connections");
  });

  /** A spelling claimed by an earlier concept must not be handed out again,
   * or one reading would appear under two labels. */
  it("hands a path to one concept only", () => {
    const matched = matchConcepts(
      new Set(["connections", "connections/max", "sessions"]),
    );
    const spellings = [...matched.values()];
    expect(new Set(spellings).size).toBe(spellings.length);
  });

  it("has nothing to match in an empty broker", () => {
    expect(matchConcepts(new Set())).toEqual(new Map());
  });
});

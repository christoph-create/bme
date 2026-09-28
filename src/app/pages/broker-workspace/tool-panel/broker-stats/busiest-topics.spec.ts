import { describe, expect, it } from "vitest";

import { busiestTopics } from "./busiest-topics";

describe("busiestTopics", () => {
  it("ranks by count, busiest first", () => {
    const ranked = busiestTopics(
      new Map([
        ["quiet", 2],
        ["loud", 40],
        ["middling", 9],
      ]),
      5,
    );

    expect(ranked.map((entry) => entry.topic)).toEqual([
      "loud",
      "middling",
      "quiet",
    ]);
  });

  it("takes only as many as asked for", () => {
    const perTopic = new Map([
      ["a", 5],
      ["b", 4],
      ["c", 3],
    ]);

    expect(busiestTopics(perTopic, 2)).toHaveLength(2);
    expect(busiestTopics(perTopic, 0)).toEqual([]);
  });

  /** A list that reshuffles on every message is unreadable, and equal counts
   * are the common case on a quiet broker. */
  it("breaks ties on the topic name, so the rows hold still", () => {
    const ranked = busiestTopics(
      new Map([
        ["zulu", 3],
        ["alpha", 3],
        ["mike", 3],
      ]),
      3,
    );

    expect(ranked.map((entry) => entry.topic)).toEqual([
      "alpha",
      "mike",
      "zulu",
    ]);
  });

  /** Against the total, the busiest of forty topics would be a sliver. The
   * bars compare these topics with each other. */
  it("scales the bars against the busiest, not the total", () => {
    const ranked = busiestTopics(
      new Map([
        ["loud", 40],
        ["half", 20],
      ]),
      5,
    );

    expect(ranked[0].share).toBe(100);
    expect(ranked[1].share).toBe(50);
  });

  it("has nothing to rank before anything has arrived", () => {
    expect(busiestTopics(new Map(), 5)).toEqual([]);
  });
});

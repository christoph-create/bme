import { describe, expect, it } from "vitest";

import { otherSysTopics } from "./other-sys-topics";

describe("otherSysTopics", () => {
  it("leaves out what the catalogue already shows", () => {
    const others = otherSysTopics(
      new Map([
        ["$SYS/broker/uptime", "91240 seconds"],
        ["$SYS/broker/something/odd", "7"],
      ]),
    );

    expect(others).toEqual([
      { topic: "$SYS/broker/something/odd", value: "7" },
    ]);
  });

  /** The whole point: EMQX, HiveMQ and VerneMQ publish none of mosquitto's
   * tree, and would otherwise show an empty panel with no explanation. */
  it("catches a broker with an entirely different tree", () => {
    const others = otherSysTopics(
      new Map([
        ["$SYS/brokers/emqx@127.0.0.1/version", "5.4.1"],
        ["$SYS/brokers/emqx@127.0.0.1/uptime", "3 days"],
      ]),
    );

    expect(others.map((entry) => entry.topic)).toEqual([
      "$SYS/brokers/emqx@127.0.0.1/uptime",
      "$SYS/brokers/emqx@127.0.0.1/version",
    ]);
  });

  it("sorts by topic, there being no better order to impose", () => {
    const others = otherSysTopics(
      new Map([
        ["$SYS/zulu", "1"],
        ["$SYS/alpha", "2"],
      ]),
    );

    expect(others.map((entry) => entry.topic)).toEqual([
      "$SYS/alpha",
      "$SYS/zulu",
    ]);
  });

  it("has nothing to say about a fully catalogued broker", () => {
    expect(
      otherSysTopics(new Map([["$SYS/broker/uptime", "1 seconds"]])),
    ).toEqual([]);
  });
});

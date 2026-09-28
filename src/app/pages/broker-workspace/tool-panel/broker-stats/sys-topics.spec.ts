import { describe, expect, it } from "vitest";

import {
  SYS_CATALOG,
  describeSysTopic,
  formatSysValue,
  groupSysReadings,
  parseSysNumber,
} from "./sys-topics";

/** A mosquitto 2.x broker, as captured from `$SYS/#`. */
const MOSQUITTO = new Map([
  ["$SYS/broker/version", "mosquitto version 2.0.18"],
  ["$SYS/broker/uptime", "91240 seconds"],
  ["$SYS/broker/clients/connected", "17"],
  ["$SYS/broker/clients/total", "24"],
  ["$SYS/broker/subscriptions/count", "84"],
  ["$SYS/broker/messages/received", "184320"],
  ["$SYS/broker/retained messages/count", "31"],
  ["$SYS/broker/bytes/received", "9112384"],
  ["$SYS/broker/load/messages/received/1min", "4.31"],
  ["$SYS/broker/heap/current", "12582912"],
]);

describe("the catalogue", () => {
  it("only holds $SYS topics", () => {
    for (const topic of SYS_CATALOG.keys()) {
      expect(topic.startsWith("$SYS/")).toBe(true);
    }
  });

  it("has nothing to say about a topic it doesn't know", () => {
    expect(describeSysTopic("$SYS/brokers/emqx@127.0.0.1/uptime")).toBeNull();
    expect(describeSysTopic("home/livingroom/climate")).toBeNull();
  });

  /** Mosquitto spells this one with a literal space, which is exactly the
   * sort of thing that silently stops matching. */
  it("knows the topics with spaces in them", () => {
    expect(describeSysTopic("$SYS/broker/retained messages/count")?.label).toBe(
      "Retained",
    );
  });

  /** Mosquitto renamed these between versions; an older broker must not fall
   * through to the raw table. */
  it("carries both heap spellings", () => {
    expect(describeSysTopic("$SYS/broker/heap/current")?.label).toBe(
      "Heap now",
    );
    expect(describeSysTopic("$SYS/broker/heap/current size")?.label).toBe(
      "Heap now",
    );
  });
});

describe("parseSysNumber", () => {
  it("reads a bare number", () => {
    expect(parseSysNumber("184320")).toBe(184_320);
    expect(parseSysNumber("4.31")).toBe(4.31);
  });

  /** Uptime is the one value in the tree that isn't just a numeral. */
  it("tolerates a trailing unit word", () => {
    expect(parseSysNumber("91240 seconds")).toBe(91_240);
  });

  it("gives up on something that isn't a number at all", () => {
    expect(parseSysNumber("mosquitto version 2.0.18")).toBeNull();
    expect(parseSysNumber("")).toBeNull();
  });
});

describe("formatSysValue", () => {
  it("formats by kind", () => {
    expect(formatSysValue("91240 seconds", "duration")).toBe("1d 1h");
    expect(formatSysValue("184320", "count")).toBe("184,320");
    expect(formatSysValue("9112384", "bytes")).toBe("9.1 MB");
    expect(formatSysValue("4.31", "perMinute")).toBe("4.31/min");
    expect(formatSysValue(" mosquitto 2.0.18 ", "text")).toBe(
      "mosquitto 2.0.18",
    );
  });

  /** Whatever the broker said is more use than an admission that we didn't
   * understand it. */
  it("falls back to the raw text rather than to a dash", () => {
    expect(formatSysValue("unavailable", "count")).toBe("unavailable");
  });
});

describe("groupSysReadings", () => {
  it("groups, labels and formats a mosquitto broker", () => {
    const groups = groupSysReadings(MOSQUITTO);

    expect(groups.map((g) => g.group)).toEqual([
      "Broker",
      "Clients",
      "Messages",
      "Traffic",
      "Load",
      "Memory",
    ]);
    expect(groups[0].readings).toEqual([
      {
        topic: "$SYS/broker/version",
        label: "Version",
        value: "mosquitto version 2.0.18",
      },
      { topic: "$SYS/broker/uptime", label: "Broker uptime", value: "1d 1h" },
    ]);
  });

  /** A broker that publishes half the tree should show half the panel, not a
   * column of dashes. */
  it("leaves out what the broker didn't publish", () => {
    const groups = groupSysReadings(
      new Map([["$SYS/broker/clients/connected", "3"]]),
    );

    expect(groups).toEqual([
      {
        group: "Clients",
        readings: [
          {
            topic: "$SYS/broker/clients/connected",
            label: "Connected",
            value: "3",
          },
        ],
      },
    ]);
  });

  /** A broker mid-upgrade could publish both heap spellings, and "Heap now"
   * appearing twice would read as a bug. */
  it("shows a label once, however many topics carry it", () => {
    const groups = groupSysReadings(
      new Map([
        ["$SYS/broker/heap/current", "100"],
        ["$SYS/broker/heap/current size", "100"],
      ]),
    );

    expect(groups[0].readings.map((r) => r.label)).toEqual(["Heap now"]);
  });

  /** EMQX, HiveMQ and VerneMQ publish none of mosquitto's tree. Showing them
   * nothing here is correct - `other-sys-topics.ts` is what catches them. */
  it("has nothing for a broker with a different tree", () => {
    expect(
      groupSysReadings(
        new Map([
          ["$SYS/brokers/emqx@127.0.0.1/uptime", "3 days"],
          ["$SYS/brokers/emqx@127.0.0.1/version", "5.4.1"],
        ]),
      ),
    ).toEqual([]);
  });

  it("copes with a broker that has published nothing yet", () => {
    expect(groupSysReadings(new Map())).toEqual([]);
  });
});

/**
 * Every topic an idle `eclipse-mosquitto` 2.1.2 actually published in one
 * `$SYS/#` capture, values and all. Copied verbatim rather than trimmed,
 * because the point of it is to be what a broker really says - including the
 * one topic with a space in it and the one value that isn't a bare numeral.
 */
const MOSQUITTO_CAPTURE: ReadonlyMap<string, string> = new Map([
  ["$SYS/broker/bytes/received", "42"],
  ["$SYS/broker/bytes/sent", "4494"],
  ["$SYS/broker/clients/active", "1"],
  ["$SYS/broker/clients/connected", "1"],
  ["$SYS/broker/clients/disconnected", "0"],
  ["$SYS/broker/clients/expired", "0"],
  ["$SYS/broker/clients/inactive", "0"],
  ["$SYS/broker/clients/total", "1"],
  ["$SYS/broker/connections/socket/count", "1"],
  ["$SYS/broker/heap/current", "840119"],
  ["$SYS/broker/heap/maximum", "846732"],
  ["$SYS/broker/load/bytes/received/1min", "33.03"],
  ["$SYS/broker/load/connections/1min", "0.78"],
  ["$SYS/broker/load/messages/received/15min", "0.20"],
  ["$SYS/broker/load/messages/received/1min", "2.48"],
  ["$SYS/broker/load/messages/received/5min", "0.58"],
  ["$SYS/broker/load/messages/sent/15min", "4.99"],
  ["$SYS/broker/load/messages/sent/1min", "57.69"],
  ["$SYS/broker/load/messages/sent/5min", "14.16"],
  ["$SYS/broker/load/publish/dropped/1min", "0.00"],
  ["$SYS/broker/load/sockets/1min", "0.78"],
  ["$SYS/broker/messages/received", "3"],
  ["$SYS/broker/messages/sent", "114"],
  ["$SYS/broker/messages/stored", "55"],
  ["$SYS/broker/packet/out/count", "0"],
  ["$SYS/broker/publish/bytes/received", "0"],
  ["$SYS/broker/publish/bytes/sent", "428"],
  ["$SYS/broker/publish/messages/dropped", "0"],
  ["$SYS/broker/publish/messages/received", "0"],
  ["$SYS/broker/publish/messages/sent", "115"],
  ["$SYS/broker/retained messages/count", "55"],
  ["$SYS/broker/shared_subscriptions/count", "0"],
  ["$SYS/broker/store/messages/bytes", "202"],
  ["$SYS/broker/store/messages/count", "55"],
  ["$SYS/broker/subscriptions/count", "1"],
  ["$SYS/broker/uptime", "34 seconds"],
  ["$SYS/broker/version", "mosquitto version 2.1.2"],
]);

describe("against a real mosquitto capture", () => {
  it("fills every group", () => {
    expect(groupSysReadings(MOSQUITTO_CAPTURE).map((g) => g.group)).toEqual([
      "Broker",
      "Clients",
      "Messages",
      "Traffic",
      "Load",
      "Memory",
    ]);
  });

  /** The headline readings, formatted exactly as the panel shows them. If a
   * mosquitto release renames one of these, this is where it surfaces. */
  it("reads the headline values the way the panel shows them", () => {
    const byLabel = new Map(
      groupSysReadings(MOSQUITTO_CAPTURE).flatMap((group) =>
        group.readings.map((r) => [r.label, r.value] as const),
      ),
    );

    expect(byLabel.get("Version")).toBe("mosquitto version 2.1.2");
    expect(byLabel.get("Broker uptime")).toBe("34s");
    expect(byLabel.get("Connected")).toBe("1");
    expect(byLabel.get("Retained")).toBe("55");
    expect(byLabel.get("Bytes out")).toBe("4.5 KB");
    expect(byLabel.get("Messages in, 1 min")).toBe("2.48/min");
    expect(byLabel.get("Heap now")).toBe("840 KB");
  });

  /** Not a bug - the catalogue is a curated front page, and the rest is what
   * the raw table is for. Pinned so a future trim is a decision rather than
   * an accident. */
  it("leaves the long tail to the raw table", () => {
    const catalogued = new Set(
      groupSysReadings(MOSQUITTO_CAPTURE).flatMap((g) =>
        g.readings.map((r) => r.topic),
      ),
    );
    const uncatalogued = [...MOSQUITTO_CAPTURE.keys()].filter(
      (t) => !catalogued.has(t),
    );

    expect(uncatalogued).toEqual([
      "$SYS/broker/connections/socket/count",
      "$SYS/broker/load/bytes/received/1min",
      "$SYS/broker/load/sockets/1min",
      "$SYS/broker/packet/out/count",
      "$SYS/broker/store/messages/bytes",
      "$SYS/broker/store/messages/count",
    ]);
  });
});

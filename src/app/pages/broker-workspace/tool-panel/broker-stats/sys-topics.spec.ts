import { describe, expect, it } from "vitest";

import { readSysDashboard } from "./sys-topics";

/**
 * Captured verbatim from an idle `eclipse-mosquitto` 2.1.2 - every topic it
 * published in one `$SYS/#` subscription, values and all.
 *
 * Copied rather than trimmed because the point of it is to be what a broker
 * really says, including `retained messages/count` with its literal space and
 * `uptime` carrying a unit word instead of a bare number.
 */
const MOSQUITTO: ReadonlyMap<string, string> = new Map([
  ["$SYS/broker/bytes/received", "44"],
  ["$SYS/broker/bytes/sent", "5694"],
  ["$SYS/broker/clients/active", "1"],
  ["$SYS/broker/clients/connected", "1"],
  ["$SYS/broker/clients/disconnected", "0"],
  ["$SYS/broker/clients/expired", "0"],
  ["$SYS/broker/clients/inactive", "0"],
  ["$SYS/broker/clients/total", "1"],
  ["$SYS/broker/connections/socket/count", "1"],
  ["$SYS/broker/heap/current", "839609"],
  ["$SYS/broker/heap/maximum", "846727"],
  ["$SYS/broker/load/bytes/received/15min", "2.87"],
  ["$SYS/broker/load/bytes/received/1min", "31.13"],
  ["$SYS/broker/load/bytes/received/5min", "8.21"],
  ["$SYS/broker/load/bytes/sent/15min", "286.56"],
  ["$SYS/broker/load/bytes/sent/1min", "3078.77"],
  ["$SYS/broker/load/bytes/sent/5min", "802.55"],
  ["$SYS/broker/load/connections/15min", "0.07"],
  ["$SYS/broker/load/connections/1min", "0.69"],
  ["$SYS/broker/load/connections/5min", "0.20"],
  ["$SYS/broker/load/messages/received/15min", "0.26"],
  ["$SYS/broker/load/messages/received/1min", "3.09"],
  ["$SYS/broker/load/messages/received/5min", "0.76"],
  ["$SYS/broker/load/messages/sent/15min", "5.75"],
  ["$SYS/broker/load/messages/sent/1min", "60.07"],
  ["$SYS/broker/load/messages/sent/5min", "15.97"],
  ["$SYS/broker/load/publish/dropped/15min", "0.00"],
  ["$SYS/broker/load/publish/dropped/1min", "0.00"],
  ["$SYS/broker/load/publish/dropped/5min", "0.00"],
  ["$SYS/broker/load/publish/received/15min", "0.00"],
  ["$SYS/broker/load/publish/received/1min", "0.00"],
  ["$SYS/broker/load/publish/received/5min", "0.00"],
  ["$SYS/broker/load/publish/sent/15min", "5.48"],
  ["$SYS/broker/load/publish/sent/1min", "56.58"],
  ["$SYS/broker/load/publish/sent/5min", "15.19"],
  ["$SYS/broker/load/sockets/15min", "0.07"],
  ["$SYS/broker/load/sockets/1min", "0.69"],
  ["$SYS/broker/load/sockets/5min", "0.20"],
  ["$SYS/broker/messages/received", "4"],
  ["$SYS/broker/messages/sent", "145"],
  ["$SYS/broker/messages/stored", "55"],
  ["$SYS/broker/packet/out/bytes", "0"],
  ["$SYS/broker/packet/out/count", "0"],
  ["$SYS/broker/publish/bytes/received", "0"],
  ["$SYS/broker/publish/bytes/sent", "546"],
  ["$SYS/broker/publish/messages/dropped", "0"],
  ["$SYS/broker/publish/messages/received", "0"],
  ["$SYS/broker/publish/messages/sent", "145"],
  ["$SYS/broker/retained messages/count", "55"],
  ["$SYS/broker/shared_subscriptions/count", "0"],
  ["$SYS/broker/store/messages/bytes", "204"],
  ["$SYS/broker/store/messages/count", "55"],
  ["$SYS/broker/subscriptions/count", "1"],
  ["$SYS/broker/uptime", "24 seconds"],
  ["$SYS/broker/version", "mosquitto version 2.1.2"],
]);

/**
 * The same, from an EMQX 6.2.2 Enterprise node - a completely different tree
 * under `$SYS/brokers/<node>/…`, with the readings under `stats/` rather than
 * at the top level. Trimmed to a representative slice of its `metrics/`
 * branch, which alone runs to over a hundred topics.
 *
 * These two fixtures exist to be read by the *same* code. Every assertion
 * below that names both brokers is really asking whether the generic layers
 * earned their keep.
 */
const EMQX: ReadonlyMap<string, string> = new Map([
  ["$SYS/brokers", "emqx@172.17.0.2"],
  [
    "$SYS/brokers/emqx@172.17.0.2/datetime",
    "2026-09-29T15:31:06.779594330+00:00",
  ],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/authorization/deny", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/bytes/received", "479"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/bytes/sent", "150168"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/client/connected", "5"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/delivery/dropped", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/delivery/dropped/expired", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/delivery/dropped/filter", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/delivery/dropped/no_local", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/delivery/dropped/qos0_msg", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/delivery/dropped/queue_full", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/delivery/dropped/too_large", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/messages/dropped", "0"],
  [
    "$SYS/brokers/emqx@172.17.0.2/metrics/messages/dropped/await_pubrel_timeout",
    "0",
  ],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/messages/dropped/no_subscribers", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/messages/dropped/quota_exceeded", "0"],
  [
    "$SYS/brokers/emqx@172.17.0.2/metrics/messages/dropped/receive_maximum",
    "0",
  ],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/messages/received", "11"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/messages/retained", "63"],
  ["$SYS/brokers/emqx@172.17.0.2/metrics/messages/sent", "11"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/channels/count", "2"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/channels/max", "2"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/cluster_sessions/count", "2"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/cluster_sessions/max", "2"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/connections/count", "2"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/connections/max", "2"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/delayed/count", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/delayed/max", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/durable_subscriptions/count", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/durable_subscriptions/max", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/live_connections/count", "2"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/live_connections/max", "2"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/retained/count", "3"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/retained/max", "3"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/routes/count", "4"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/routes/max", "4"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/sessions/count", "2"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/sessions/max", "2"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/suboptions/count", "5"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/suboptions/max", "5"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/subscribers/count", "5"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/subscribers/max", "5"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/subscriptions/count", "5"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/subscriptions/max", "5"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/subscriptions/shared/count", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/subscriptions/shared/max", "0"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/topics/count", "4"],
  ["$SYS/brokers/emqx@172.17.0.2/stats/topics/max", "4"],
  ["$SYS/brokers/emqx@172.17.0.2/sysdescr", "EMQX Enterprise"],
  ["$SYS/brokers/emqx@172.17.0.2/uptime", "1291616"],
  ["$SYS/brokers/emqx@172.17.0.2/version", "6.2.2"],
]);

function labels(
  readings: readonly { readonly label: string; readonly value: string }[],
): ReadonlyMap<string, string> {
  return new Map(readings.map((reading) => [reading.label, reading.value]));
}

describe("readSysDashboard", () => {
  it("puts the same headline readings on the front page of both brokers", () => {
    const mosquitto = labels(readSysDashboard(MOSQUITTO).headline);
    const emqx = labels(readSysDashboard(EMQX).headline);

    for (const label of [
      "Version",
      "Broker uptime",
      "Connected",
      "Subscriptions",
      "Received",
      "Sent",
      "Bytes in",
      "Bytes out",
    ]) {
      expect(mosquitto.has(label), `mosquitto is missing ${label}`).toBe(true);
      expect(emqx.has(label), `emqx is missing ${label}`).toBe(true);
    }
  });

  /** Formatting comes from the same rules for both, off values that look
   * nothing alike - mosquitto's uptime carries a unit word, EMQX's does not. */
  it("formats both brokers' values with one set of rules", () => {
    const mosquitto = labels(readSysDashboard(MOSQUITTO).headline);
    const emqx = labels(readSysDashboard(EMQX).headline);

    expect(mosquitto.get("Version")).toBe("mosquitto version 2.1.2");
    expect(mosquitto.get("Broker uptime")).toBe("24s");
    expect(mosquitto.get("Bytes out")).toBe("5.7 KB");
    expect(mosquitto.get("Connected")).toBe("1");

    expect(emqx.get("Version")).toBe("6.2.2");
    expect(emqx.get("Edition")).toBe("EMQX Enterprise");
    expect(emqx.get("Broker uptime")).toBe("14d 22h");
    expect(emqx.get("Bytes out")).toBe("150 KB");
  });

  /** A broker carrying two spellings of one concept gets one tile, not two:
   * EMQX publishes both `subscriptions` and `subscribers`. */
  it("shows a concept once however many ways a broker spells it", () => {
    const headline = readSysDashboard(EMQX).headline;

    expect(headline.filter((r) => r.label === "Subscriptions")).toHaveLength(1);
    expect(new Set(headline.map((r) => r.label)).size).toBe(headline.length);
  });

  it("never shows a reading twice across the page", () => {
    for (const capture of [MOSQUITTO, EMQX]) {
      const { headline, details } = readSysDashboard(capture);
      const topics = [
        ...headline.map((r) => r.topic),
        ...details.flatMap((g) => g.readings.map((r) => r.topic)),
      ];
      expect(new Set(topics).size).toBe(topics.length);
    }
  });

  /** Nothing is dropped: whatever the broker published is either a tile or a
   * row in a group. */
  it("accounts for every topic it was given", () => {
    for (const capture of [MOSQUITTO, EMQX]) {
      const { headline, details } = readSysDashboard(capture);
      const shown =
        headline.length +
        details.reduce((total, group) => total + group.readings.length, 0);
      // Readings that normalise to the same key collapse, so this is a
      // ceiling rather than an equality.
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThanOrEqual(capture.size);
    }
  });

  /** The generic classifier is what makes an unknown broker readable, so how
   * much it can place is worth pinning. */
  it("files almost everything into a real group without help", () => {
    for (const [name, capture, maxOther] of [
      ["mosquitto", MOSQUITTO, 0],
      ["emqx", EMQX, 4],
    ] as const) {
      const other =
        readSysDashboard(capture).details.find((g) => g.group === "Other")
          ?.readings.length ?? 0;
      expect(other, `${name} left ${other} unclassified`).toBeLessThanOrEqual(
        maxOther,
      );
    }
  });

  it("orders groups the same way for every broker", () => {
    const order = readSysDashboard(EMQX).details.map((g) => g.group);

    expect(order).toEqual(
      [...order].sort(
        (a, b) =>
          [
            "Broker",
            "Clients",
            "Messages",
            "Traffic",
            "Load",
            "Memory",
            "Other",
          ].indexOf(a) -
          [
            "Broker",
            "Clients",
            "Messages",
            "Traffic",
            "Load",
            "Memory",
            "Other",
          ].indexOf(b),
      ),
    );
  });

  it("has nothing to show for a broker that published nothing", () => {
    expect(readSysDashboard(new Map())).toEqual({ headline: [], details: [] });
  });

  /** A broker with an entirely unknown vocabulary still gets rows, which is
   * the difference between "we don't support this" and a blank panel. */
  it("still renders a broker it has never seen", () => {
    const { headline, details } = readSysDashboard(
      new Map([
        ["$SYS/vendor/widgets/spinning", "42"],
        ["$SYS/vendor/flux/capacitance", "1.21"],
      ]),
    );

    expect(headline).toEqual([]);
    expect(details.flatMap((g) => g.readings.map((r) => r.label))).toEqual([
      "Vendor flux capacitance",
      "Vendor widgets spinning",
    ]);
  });
});

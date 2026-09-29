import { describe, expect, it } from "vitest";

import { normaliseSysTopic } from "./sys-normalise";

describe("normaliseSysTopic", () => {
  /** The point of the whole module: two brokers that nest the same reading
   * differently come out as one key, so nothing downstream needs to know
   * which broker it is talking to. */
  it("reduces mosquitto and EMQX to the same key", () => {
    expect(normaliseSysTopic("$SYS/broker/subscriptions/count")).toBe(
      "subscriptions",
    );
    expect(
      normaliseSysTopic(
        "$SYS/brokers/emqx@172.17.0.2/stats/subscriptions/count",
      ),
    ).toBe("subscriptions");
  });

  it("agrees on the readings that already line up", () => {
    for (const [mosquitto, emqx, expected] of [
      [
        "$SYS/broker/bytes/received",
        "$SYS/brokers/emqx@172.17.0.2/metrics/bytes/received",
        "bytes/received",
      ],
      [
        "$SYS/broker/messages/sent",
        "$SYS/brokers/emqx@172.17.0.2/metrics/messages/sent",
        "messages/sent",
      ],
      ["$SYS/broker/uptime", "$SYS/brokers/emqx@172.17.0.2/uptime", "uptime"],
    ] as const) {
      expect(normaliseSysTopic(mosquitto)).toBe(expected);
      expect(normaliseSysTopic(emqx)).toBe(expected);
    }
  });

  it("drops the scaffolding and nothing else", () => {
    expect(normaliseSysTopic("$SYS/broker/clients/connected")).toBe(
      "clients/connected",
    );
    expect(normaliseSysTopic("$SYS/broker/load/messages/received/1min")).toBe(
      "load/messages/received/1min",
    );
  });

  /** The node names the machine, never the reading - keeping it would make
   * every EMQX key unique to the host it came from. */
  it("drops the cluster node", () => {
    expect(
      normaliseSysTopic("$SYS/brokers/emqx@172.17.0.2/stats/topics/count"),
    ).toBe("topics");
    expect(normaliseSysTopic("$SYS/brokers/rabbit@node-1/version")).toBe(
      "version",
    );
  });

  /** `count` is the default reading of anything countable; `max` is the one
   * that distinguishes, so it stays. */
  it("drops a trailing count but keeps max", () => {
    expect(normaliseSysTopic("$SYS/broker/retained messages/count")).toBe(
      "retained messages",
    );
    expect(
      normaliseSysTopic("$SYS/brokers/emqx@1.2.3.4/stats/connections/max"),
    ).toBe("connections/max");
  });

  /** EMQX publishes the node name here, so it is a real reading rather than
   * an empty one. */
  it("keeps a topic that is nothing but scaffolding", () => {
    expect(normaliseSysTopic("$SYS/brokers")).toBe("brokers");
  });

  it("lower-cases, so a broker's capitalisation doesn't fork the key", () => {
    expect(normaliseSysTopic("$SYS/Broker/Clients/Connected")).toBe(
      "clients/connected",
    );
  });

  it("copes with odd input", () => {
    expect(normaliseSysTopic("$SYS/")).toBe("");
    expect(normaliseSysTopic("$SYS/broker//uptime")).toBe("uptime");
    // Not a $SYS topic at all: normalised on its own terms rather than
    // rejected, since the caller has already filtered.
    expect(normaliseSysTopic("home/livingroom/climate")).toBe(
      "home/livingroom/climate",
    );
  });
});

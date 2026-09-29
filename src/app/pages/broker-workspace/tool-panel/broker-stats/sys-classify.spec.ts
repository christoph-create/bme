import { describe, expect, it } from "vitest";

import { formatOf, groupOf, labelOf } from "./sys-classify";

describe("groupOf", () => {
  it("places mosquitto's vocabulary", () => {
    expect(groupOf("uptime")).toBe("Broker");
    expect(groupOf("clients/connected")).toBe("Clients");
    expect(groupOf("retained messages")).toBe("Messages");
    expect(groupOf("bytes/received")).toBe("Traffic");
    expect(groupOf("heap/current")).toBe("Memory");
  });

  /** The same rules, no per-broker knowledge - EMQX says "connections" where
   * mosquitto says "clients", and both mean the same group. */
  it("places EMQX's vocabulary", () => {
    expect(groupOf("connections")).toBe("Clients");
    expect(groupOf("sessions/max")).toBe("Clients");
    expect(groupOf("authorization/deny")).toBe("Clients");
    expect(groupOf("messages/dropped")).toBe("Messages");
    expect(groupOf("packet/out")).toBe("Traffic");
  });

  /** Load averages are counts of messages, so `message` would claim them if
   * it came first. */
  it("lets the more specific keyword win", () => {
    expect(groupOf("load/messages/received/1min")).toBe("Load");
    expect(groupOf("load/bytes/sent/5min")).toBe("Load");
  });

  it("admits when it doesn't know", () => {
    expect(groupOf("rules/matched")).toBe("Other");
    expect(groupOf("suboptions")).toBe("Clients");
  });
});

describe("formatOf", () => {
  /** One broker publishes `"34 seconds"` and the other `"1291616"`; the word
   * in the topic is what settles it, not the value. */
  it("reads uptime as a duration whatever shape the value has", () => {
    expect(formatOf("uptime", "34 seconds")).toBe("duration");
    expect(formatOf("uptime", "1291616")).toBe("duration");
  });

  it("reads bytes and memory as bytes", () => {
    expect(formatOf("bytes/received", "42")).toBe("bytes");
    expect(formatOf("heap/current", "840119")).toBe("bytes");
  });

  it("reads load averages as a per-minute rate", () => {
    expect(formatOf("load/messages/received/1min", "2.48")).toBe("perMinute");
  });

  it("falls back to the shape of the value", () => {
    expect(formatOf("connections", "2")).toBe("count");
    expect(formatOf("something/odd", "0.75")).toBe("decimal");
    expect(formatOf("version", "mosquitto version 2.1.2")).toBe("text");
    expect(formatOf("sysdescr", "EMQX Enterprise")).toBe("text");
  });
});

describe("labelOf", () => {
  it("reads a path out loud", () => {
    expect(labelOf("clients/connected")).toBe("Clients connected");
    expect(labelOf("messages/dropped")).toBe("Messages dropped");
  });

  it("splits the separators brokers use inside a segment", () => {
    expect(labelOf("cluster_sessions/max")).toBe("Cluster sessions max");
    expect(labelOf("authorization/cache_hit")).toBe("Authorization cache hit");
  });

  /** The group heading already says "Load", and `1min` is a unit rather than
   * a word. */
  it("drops what the grouping already says, and spaces the units", () => {
    expect(labelOf("load/messages/received/1min")).toBe(
      "Messages received 1 min",
    );
  });

  it("leaves a single segment alone but for its capital", () => {
    expect(labelOf("subscriptions")).toBe("Subscriptions");
  });
});

import { describe, expect, it } from "vitest";

import { MqttEvent } from "../models/mqtt-event.model";
import { QoS } from "../models/qos";
import { readRateWindow } from "./rate-window";
import {
  MAX_TRACKED_TOPICS,
  SessionStats,
  emptySessionStats,
  recordPublished,
  reduceSessionStats,
} from "./session-stats";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";
const START = 1_700_000_000_000;

function received(
  overrides: Partial<{
    topic: string;
    payload_len: number;
    qos: QoS;
    retain: boolean;
  }> = {},
): MqttEvent {
  return {
    MessageReceived: {
      connection_id: CONNECTION_ID,
      topic: "home/livingroom/climate",
      payload: [1, 2, 3],
      payload_len: 3,
      qos: "AtMostOnce",
      retain: false,
      ...overrides,
    },
  };
}

/** Folds a list of events in at a single instant, which is all most of these
 * care about. */
function fold(events: readonly MqttEvent[], atMs = START): SessionStats {
  return events.reduce(
    (stats, event) => reduceSessionStats(stats, event, atMs),
    emptySessionStats(START),
  );
}

describe("reduceSessionStats", () => {
  it("counts messages and payload bytes", () => {
    const stats = fold([
      received({ payload_len: 10 }),
      received({ payload_len: 32 }),
    ]);

    expect(stats.messagesIn).toBe(2);
    expect(stats.payloadBytesIn).toBe(42);
    expect(stats.lastMessageAt).toBe(START);
  });

  /** `payload` is capped at 256 KiB for IPC; `payload_len` is what actually
   * crossed the wire, and it is the only one of the two worth totalling. */
  it("totals the wire length, not the bytes that survived the IPC cap", () => {
    const truncated: MqttEvent = {
      MessageReceived: {
        connection_id: CONNECTION_ID,
        topic: "big",
        payload: [1, 2, 3],
        payload_len: 500_000,
        qos: "AtMostOnce",
        retain: false,
      },
    };

    expect(fold([truncated]).payloadBytesIn).toBe(500_000);
  });

  it("tallies QoS and retained separately", () => {
    const stats = fold([
      received({ qos: "AtLeastOnce" }),
      received({ qos: "AtLeastOnce", retain: true }),
      received({ qos: "ExactlyOnce" }),
    ]);

    expect(stats.byQos).toEqual({
      AtMostOnce: 0,
      AtLeastOnce: 2,
      ExactlyOnce: 1,
    });
    expect(stats.retainedIn).toBe(1);
  });

  it("counts per topic", () => {
    const stats = fold([
      received({ topic: "a" }),
      received({ topic: "b" }),
      received({ topic: "a" }),
    ]);

    expect([...stats.perTopic]).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
  });

  it("feeds the rate window", () => {
    let stats = emptySessionStats(START);
    for (let i = 0; i < 6; i++) {
      stats = reduceSessionStats(stats, received({ payload_len: 5 }), START);
    }

    const reading = readRateWindow(stats.rate, START + 1000);
    expect(reading.messagesPerSecond).toBe(6);
    expect(reading.bytesPerSecond).toBe(30);
  });

  /** The broker panel's own subscription must not show up in the numbers it
   * sits next to, or turning it on would appear to change the traffic. */
  it("ignores $SYS traffic entirely, without touching the record", () => {
    const before = emptySessionStats(START);

    const after = reduceSessionStats(
      before,
      received({ topic: "$SYS/broker/uptime", payload_len: 12 }),
      START,
    );

    expect(after).toBe(before);
  });

  it("stops tracking new topics past the cap, but keeps counting known ones", () => {
    let stats = emptySessionStats(START);
    for (let i = 0; i < MAX_TRACKED_TOPICS; i++) {
      stats = reduceSessionStats(stats, received({ topic: `t/${i}` }), START);
    }

    stats = reduceSessionStats(stats, received({ topic: "t/0" }), START);
    stats = reduceSessionStats(stats, received({ topic: "brand/new" }), START);

    expect(stats.perTopic.size).toBe(MAX_TRACKED_TOPICS);
    expect(stats.perTopic.get("t/0")).toBe(2);
    expect(stats.perTopic.has("brand/new")).toBe(false);
    // The message itself still counts - only the per-topic breakdown gives up.
    expect(stats.messagesIn).toBe(MAX_TRACKED_TOPICS + 2);
  });

  it("marks the link up and down", () => {
    const up = reduceSessionStats(
      emptySessionStats(START),
      { Connected: { connection_id: CONNECTION_ID } },
      START + 500,
    );
    expect(up.connectedAt).toBe(START + 500);

    const down = reduceSessionStats(
      up,
      { Disconnected: { connection_id: CONNECTION_ID } },
      START + 900,
    );
    expect(down.connectedAt).toBeNull();
  });

  /** The backend emits one `Reconnecting` per retry, so counting every one
   * would report a single outage as five. */
  it("counts an outage once, however many attempts it takes", () => {
    let stats = emptySessionStats(START);
    for (const attempt of [1, 2, 3]) {
      stats = reduceSessionStats(
        stats,
        {
          Reconnecting: {
            connection_id: CONNECTION_ID,
            attempt,
            max_attempts: 10,
            delay_ms: 1000,
          },
        },
        START,
      );
    }
    stats = reduceSessionStats(
      stats,
      { Connected: { connection_id: CONNECTION_ID } },
      START,
    );

    expect(stats.reconnects).toBe(1);
    expect(stats.connectedAt).toBe(START);
  });

  /** Counters are per session, not per link: a broker that blips must not
   * reset the totals the user is watching. */
  it("carries totals across a reconnect", () => {
    let stats = fold([received(), received()]);
    stats = reduceSessionStats(
      stats,
      {
        Reconnecting: {
          connection_id: CONNECTION_ID,
          attempt: 1,
          max_attempts: 10,
          delay_ms: 1000,
        },
      },
      START,
    );
    stats = reduceSessionStats(
      stats,
      { Connected: { connection_id: CONNECTION_ID } },
      START,
    );

    expect(stats.messagesIn).toBe(2);
    expect(stats.startedAt).toBe(START);
  });

  it("leaves the record untouched for events that say nothing about throughput", () => {
    const before = emptySessionStats(START);

    const warned = reduceSessionStats(
      before,
      { Warning: { connection_id: CONNECTION_ID, message: "too big" } },
      START,
    );
    const alreadyDown = reduceSessionStats(
      before,
      { Disconnected: { connection_id: CONNECTION_ID } },
      START,
    );

    expect(warned).toBe(before);
    expect(alreadyDown).toBe(before);
  });
});

describe("recordPublished", () => {
  it("counts outbound separately from inbound", () => {
    const stats = recordPublished(
      recordPublished(fold([received({ payload_len: 3 })]), 100),
      40,
    );

    expect(stats.messagesOut).toBe(2);
    expect(stats.payloadBytesOut).toBe(140);
    expect(stats.messagesIn).toBe(1);
    expect(stats.payloadBytesIn).toBe(3);
  });

  /** The rate tile reads "messages in per second" and sits beside "messages
   * in", so publishing must not move it. */
  it("stays out of the inbound rate", () => {
    const stats = recordPublished(emptySessionStats(START), 100);

    expect(readRateWindow(stats.rate, START + 2000).messagesPerSecond).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";

import { StoredMessage } from "../../../../core/models/stored-message.model";
import { buildSamples } from "./sample-series";

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  const payload = overrides.payload ?? [];
  return {
    payload,
    payloadLen: payload.length,
    qos: "AtMostOnce",
    retain: false,
    receivedAt: 1000,
    ...overrides,
  };
}

/** Stands in for the card's memoized decode+parse. */
function parseAs(values: readonly unknown[]): (m: StoredMessage) => unknown {
  const byMessage = new Map<number, unknown>();
  values.forEach((value, index) => byMessage.set(index, value));
  return (m) => byMessage.get(m.receivedAt);
}

describe("buildSamples", () => {
  it("returns nothing for an empty history", () => {
    expect(buildSamples([], ["temp"], () => ({ temp: 1 }))).toEqual([]);
  });

  it("pairs each message's timestamp with the value at the path", () => {
    const messages = [
      message({ receivedAt: 0 }),
      message({ receivedAt: 1 }),
    ];

    expect(
      buildSamples(messages, ["temp"], parseAs([{ temp: 20 }, { temp: 21 }])),
    ).toEqual([
      { t: 0, v: 20 },
      { t: 1, v: 21 },
    ]);
  });

  it("reads a bare numeric payload through an empty path", () => {
    const messages = [message({ receivedAt: 0 })];

    expect(buildSamples(messages, [], parseAs([23.5]))).toEqual([
      { t: 0, v: 23.5 },
    ]);
  });

  it("returns nothing when no message carries the field", () => {
    const messages = [message({ receivedAt: 0 }), message({ receivedAt: 1 })];

    expect(
      buildSamples(messages, ["temp"], parseAs([{ other: 1 }, { other: 2 }])),
    ).toEqual([]);
  });

  it("drops messages missing the field rather than plotting them as zero", () => {
    const messages = [
      message({ receivedAt: 0 }),
      message({ receivedAt: 1 }),
      message({ receivedAt: 2 }),
    ];

    expect(
      buildSamples(
        messages,
        ["temp"],
        parseAs([{ temp: 20 }, { other: 1 }, { temp: 22 }]),
      ),
    ).toEqual([
      { t: 0, v: 20 },
      { t: 2, v: 22 },
    ]);
  });

  it("preserves the store's oldest-first order", () => {
    const messages = [
      message({ receivedAt: 0 }),
      message({ receivedAt: 1 }),
      message({ receivedAt: 2 }),
    ];

    const times = buildSamples(
      messages,
      ["temp"],
      parseAs([{ temp: 3 }, { temp: 1 }, { temp: 2 }]),
    ).map((s) => s.t);

    expect(times).toEqual([0, 1, 2]);
  });

  it("calls parse exactly once per message, so the caller's memo does the work", () => {
    const messages = [
      message({ receivedAt: 0 }),
      message({ receivedAt: 1 }),
      message({ receivedAt: 2 }),
    ];
    const parse = vi.fn(parseAs([{ temp: 1 }, { temp: 2 }, { temp: 3 }]));

    buildSamples(messages, ["temp"], parse);

    expect(parse).toHaveBeenCalledTimes(3);
  });
});

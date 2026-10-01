import { describe, expect, it } from "vitest";

import { ComparePins } from "../../../../core/models/compare-pin.model";
import { StoredMessage } from "../../../../core/models/stored-message.model";
import {
  SideText,
  compareFace,
  readSide,
  selectCompareSides,
} from "./compare-state";

function message(
  text: string,
  overrides: Partial<StoredMessage> = {},
): StoredMessage {
  const payload = [...new TextEncoder().encode(text)];
  return {
    payload,
    payloadLen: payload.length,
    qos: "AtMostOnce",
    retain: false,
    properties: null,
    receivedAt: 0,
    ...overrides,
  };
}

const isJson = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

function pins(
  topic: string,
  a: StoredMessage,
  b: StoredMessage | null = null,
): ComparePins {
  return { topic, a, b, pinnedAt: 0 };
}

describe("selectCompareSides", () => {
  it("takes the newest two messages when live", () => {
    const first = message("1");
    const second = message("2");
    const third = message("3");
    expect(
      selectCompareSides({
        selectedTopic: "t",
        messages: [first, second, third],
        pins: null,
      }),
    ).toEqual({ mode: "live", before: second, after: third, sameMessage: false });
  });

  it("has no before side with a single message", () => {
    const only = message("1");
    const selection = selectCompareSides({
      selectedTopic: "t",
      messages: [only],
      pins: null,
    });
    expect(selection.before).toBeNull();
    expect(selection.after).toBe(only);
  });

  it("has neither side with no messages", () => {
    const selection = selectCompareSides({
      selectedTopic: "t",
      messages: [],
      pins: null,
    });
    expect(selection).toEqual({
      mode: "live",
      before: null,
      after: null,
      sameMessage: false,
    });
  });

  it("freezes A and lets B follow the newest message when pinned", () => {
    const baseline = message("1");
    const newest = message("3");
    const selection = selectCompareSides({
      selectedTopic: "t",
      messages: [baseline, message("2"), newest],
      pins: pins("t", baseline),
    });
    expect(selection).toEqual({
      mode: "pinned",
      before: baseline,
      after: newest,
      sameMessage: false,
    });
  });

  it("freezes both sides when B is pinned too", () => {
    const baseline = message("1");
    const second = message("2");
    const selection = selectCompareSides({
      selectedTopic: "t",
      messages: [baseline, second, message("3")],
      pins: pins("t", baseline, second),
    });
    expect(selection.after).toBe(second);
  });

  it("falls back to live while another topic is selected", () => {
    const first = message("1");
    const second = message("2");
    const selection = selectCompareSides({
      selectedTopic: "other",
      messages: [first, second],
      pins: pins("t", message("x")),
    });
    expect(selection.mode).toBe("live");
    expect(selection.before).toBe(first);
  });

  it("keeps a baseline that the store's cap has already evicted", () => {
    const evicted = message("old");
    const newest = message("new");
    const selection = selectCompareSides({
      selectedTopic: "t",
      messages: [newest],
      pins: pins("t", evicted),
    });
    expect(selection.before).toBe(evicted);
    expect(selection.after).toBe(newest);
  });

  it("reports the same message on both sides when the pin is on the newest", () => {
    const newest = message("1");
    const selection = selectCompareSides({
      selectedTopic: "t",
      messages: [newest],
      pins: pins("t", newest),
    });
    expect(selection.sameMessage).toBe(true);
  });
});

describe("readSide", () => {
  it("reads a JSON payload as diffable JSON", () => {
    expect(readSide(message('{"a":1}'), isJson)).toEqual({
      ok: true,
      text: '{"a":1}',
      json: true,
    });
  });

  it("reads a plain-text payload as diffable non-JSON", () => {
    expect(readSide(message("ON"), isJson)).toEqual({
      ok: true,
      text: "ON",
      json: false,
    });
  });

  it("refuses an empty payload", () => {
    const empty: StoredMessage = { ...message(""), payloadLen: 0 };
    expect(readSide(empty, isJson)).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses a payload that did not arrive whole", () => {
    const clipped = message('{"a":1}', { payloadLen: 500_000 });
    expect(readSide(clipped, isJson)).toEqual({
      ok: false,
      reason: "truncated",
    });
  });

  it("refuses a payload that is not text", () => {
    const binary: StoredMessage = {
      ...message(""),
      payload: [0xff, 0xfe, 0xff, 0xfe],
      payloadLen: 4,
    };
    expect(readSide(binary, isJson)).toEqual({ ok: false, reason: "binary" });
  });

  it("diffs a payload whose text is the stream's own sentinel as that text", () => {
    // Proof the lossy `formatMessageBody` labels are not being consumed: a
    // device really can publish "(empty)" or "<binary, 9 bytes>".
    expect(readSide(message("(empty)"), isJson)).toEqual({
      ok: true,
      text: "(empty)",
      json: false,
    });
    expect(readSide(message("<binary, 9 bytes>"), isJson)).toMatchObject({
      ok: true,
      text: "<binary, 9 bytes>",
    });
  });
});

describe("compareFace", () => {
  const ok = (text: string, json = false): SideText => ({ ok: true, text, json });

  function face(overrides: Partial<Parameters<typeof compareFace>[0]> = {}) {
    return compareFace({
      selectedTopic: "t",
      historyEmpty: false,
      sameMessage: false,
      before: ok("a"),
      after: ok("b"),
      ...overrides,
    });
  }

  it("asks for a topic first", () => {
    expect(face({ selectedTopic: null, historyEmpty: true })).toBe("no-topic");
  });

  it("says a selected topic is quiet", () => {
    expect(face({ historyEmpty: true, before: null, after: null })).toBe(
      "no-messages",
    );
  });

  it("waits for something newer when the pin is on the newest message", () => {
    expect(face({ sameMessage: true })).toBe("awaiting-newer");
  });

  it("waits for something newer when a pin outlived a cleared topic", () => {
    // The pin survives a Clear, so "no messages yet" would be the wrong story.
    expect(face({ historyEmpty: true, after: null })).toBe("awaiting-newer");
  });

  it("says one message is not enough", () => {
    expect(face({ before: null })).toBe("single-message");
  });

  it("explains a side it cannot diff", () => {
    expect(face({ after: { ok: false, reason: "binary" } })).toBe("not-diffable");
  });

  it("prefers the undiffable explanation over a line diff", () => {
    expect(
      face({ before: { ok: false, reason: "truncated" }, after: ok("b") }),
    ).toBe("not-diffable");
  });

  it("says so in one line when the payloads match", () => {
    expect(face({ before: ok("same", true), after: ok("same", true) })).toBe(
      "identical",
    );
  });

  it("uses the field table when both sides are JSON", () => {
    expect(face({ before: ok("{}", true), after: ok("{\"a\":1}", true) })).toBe(
      "json",
    );
  });

  it("falls back to a line diff when only one side is JSON", () => {
    expect(face({ before: ok("{}", true), after: ok("ON") })).toBe("lines");
  });

  it("falls back to a line diff when neither side is JSON", () => {
    expect(face({ before: ok("ON"), after: ok("OFF") })).toBe("lines");
  });
});

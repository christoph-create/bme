import { describe, expect, it } from "vitest";

import { StoredMessage } from "../../../core/models/stored-message.model";
import { messageToDraft } from "./message-to-draft";

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    payload: Array.from(new TextEncoder().encode("hello")),
    qos: "AtMostOnce",
    retain: false,
    receivedAt: Date.now(),
    ...overrides,
  };
}

function encode(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** Stands in for JsonFormatService.format(text).ok. */
function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

describe("messageToDraft", () => {
  it("carries topic, decoded payload, QoS and retain into the draft", () => {
    const draft = messageToDraft(
      "sensors/temp",
      message({
        payload: encode("21.5"),
        qos: "ExactlyOnce",
        retain: true,
      }),
      isJson,
    );

    expect(draft).toEqual({
      topic: "sensors/temp",
      payload: "21.5",
      format: "json",
      qos: "ExactlyOnce",
      retain: true,
    });
  });

  it("marks a JSON object payload as json", () => {
    const draft = messageToDraft(
      "a",
      message({ payload: encode('{"on":true}') }),
      isJson,
    );

    expect(draft?.format).toBe("json");
    expect(draft?.payload).toBe('{"on":true}');
  });

  it("marks a plain-text payload as raw", () => {
    const draft = messageToDraft(
      "a",
      message({ payload: encode("ON") }),
      isJson,
    );

    expect(draft?.format).toBe("raw");
    expect(draft?.payload).toBe("ON");
  });

  it("preserves whitespace and newlines in the payload", () => {
    const draft = messageToDraft(
      "a",
      message({ payload: encode('{\n  "a": 1\n}') }),
      isJson,
    );

    expect(draft?.payload).toBe('{\n  "a": 1\n}');
  });

  it("returns null for an empty payload, rather than the '(empty)' label", () => {
    expect(messageToDraft("a", message({ payload: [] }), isJson)).toBeNull();
  });

  it("returns null for a binary payload, rather than the '<binary, N bytes>' label", () => {
    const binary = Array.from({ length: 40 }, (_, i) => 0x80 + (i % 0x40));

    expect(messageToDraft("a", message({ payload: binary }), isJson)).toBeNull();
  });

  it("keeps a payload that is valid UTF-8 but not ASCII", () => {
    const draft = messageToDraft(
      "a",
      message({ payload: encode("温度 21°C") }),
      isJson,
    );

    expect(draft?.payload).toBe("温度 21°C");
    expect(draft?.format).toBe("raw");
  });
});

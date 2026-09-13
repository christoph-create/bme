import { describe, expect, it } from "vitest";
import { emptyMessageProperties } from "../../../core/models/message-properties.model";
import { formatPropertyRows } from "./format-properties";

describe("formatPropertyRows", () => {
  it("is empty for a message without properties", () => {
    expect(formatPropertyRows(null)).toEqual([]);
  });

  it("lists the standard properties first, then user properties in order", () => {
    const rows = formatPropertyRows({
      content_type: "application/json",
      payload_is_utf8: true,
      message_expiry_interval: 30,
      response_topic: "replies/1",
      correlation_data: "req-1",
      user_properties: [
        { key: "zeta", value: "1" },
        { key: "alpha", value: "2" },
      ],
    });

    expect(rows).toEqual([
      { label: "Content type", value: "application/json", user: false },
      { label: "Payload format", value: "UTF-8 text", user: false },
      { label: "Expires", value: "30 s", user: false },
      { label: "Response topic", value: "replies/1", user: false },
      { label: "Correlation data", value: "req-1", user: false },
      { label: "zeta", value: "1", user: true },
      { label: "alpha", value: "2", user: true },
    ]);
  });

  it("leaves out whatever the sender did not set", () => {
    const rows = formatPropertyRows({
      ...emptyMessageProperties(),
      response_topic: "replies/1",
    });

    expect(rows).toEqual([
      { label: "Response topic", value: "replies/1", user: false },
    ]);
  });

  it("shows an expiry in whole minutes or hours when it is one", () => {
    const expires = (seconds: number) =>
      formatPropertyRows({
        ...emptyMessageProperties(),
        message_expiry_interval: seconds,
      })[0].value;

    expect(expires(0)).toBe("0 s");
    expect(expires(45)).toBe("45 s");
    expect(expires(90)).toBe("90 s");
    expect(expires(120)).toBe("2 min");
    expect(expires(3600)).toBe("1 h");
    expect(expires(5400)).toBe("90 min");
  });
});

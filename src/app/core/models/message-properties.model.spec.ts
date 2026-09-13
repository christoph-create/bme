import { describe, expect, it } from "vitest";
import {
  emptyMessageProperties,
  isEmptyMessageProperties,
} from "./message-properties.model";

describe("isEmptyMessageProperties", () => {
  it("is true for a fresh empty object", () => {
    expect(isEmptyMessageProperties(emptyMessageProperties())).toBe(true);
  });

  it("is false as soon as any one field is set", () => {
    expect(
      isEmptyMessageProperties({
        ...emptyMessageProperties(),
        payload_is_utf8: true,
      }),
    ).toBe(false);
    expect(
      isEmptyMessageProperties({
        ...emptyMessageProperties(),
        user_properties: [{ key: "k", value: "v" }],
      }),
    ).toBe(false);
    expect(
      isEmptyMessageProperties({
        ...emptyMessageProperties(),
        message_expiry_interval: 0,
      }),
    ).toBe(false);
  });
});

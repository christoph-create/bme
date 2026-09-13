import { describe, expect, it } from "vitest";
import {
  emptyPublishPropertiesForm,
  formToProperties,
  propertiesSummaryLabel,
  propertiesToForm,
  PublishPropertiesForm,
} from "./publish-properties";

const FILLED: PublishPropertiesForm = {
  contentType: "application/json",
  responseTopic: "replies/42",
  correlationData: "req-42",
  messageExpiry: "60",
  payloadIsUtf8: true,
  userProperties: [
    { key: "trace", value: "abc" },
    { key: "trace", value: "def" },
  ],
};

describe("formToProperties", () => {
  it("is null when nothing is set, so the publish call can omit it", () => {
    expect(formToProperties(emptyPublishPropertiesForm())).toBeNull();
  });

  it("maps every field onto the wire shape", () => {
    expect(formToProperties(FILLED)).toEqual({
      content_type: "application/json",
      payload_is_utf8: true,
      message_expiry_interval: 60,
      response_topic: "replies/42",
      correlation_data: "req-42",
      user_properties: [
        { key: "trace", value: "abc" },
        { key: "trace", value: "def" },
      ],
    });
  });

  it("turns blank text into null and trims the rest", () => {
    const properties = formToProperties({
      ...emptyPublishPropertiesForm(),
      contentType: "  text/plain ",
      responseTopic: "   ",
    });

    expect(properties?.content_type).toBe("text/plain");
    expect(properties?.response_topic).toBeNull();
  });

  // An abandoned "+ Add" row is the common case; sending `"": "x"` would be
  // a valid but meaningless property.
  it("drops user properties with a blank key", () => {
    const properties = formToProperties({
      ...emptyPublishPropertiesForm(),
      userProperties: [
        { key: "", value: "orphan" },
        { key: " k ", value: " v " },
      ],
    });

    expect(properties?.user_properties).toEqual([{ key: "k", value: " v " }]);
  });

  it("treats an expiry that is not a whole number of seconds as unset", () => {
    for (const messageExpiry of ["", "abc", "-1", "1.5", "4294967296"]) {
      expect(
        formToProperties({ ...emptyPublishPropertiesForm(), messageExpiry }),
      ).toBeNull();
    }
    expect(
      formToProperties({ ...emptyPublishPropertiesForm(), messageExpiry: "0" })
        ?.message_expiry_interval,
    ).toBe(0);
  });

  it("counts the UTF-8 flag on its own as a property", () => {
    expect(
      formToProperties({ ...emptyPublishPropertiesForm(), payloadIsUtf8: true }),
    ).toEqual(expect.objectContaining({ payload_is_utf8: true }));
  });
});

describe("propertiesToForm", () => {
  it("round-trips a full set", () => {
    expect(propertiesToForm(formToProperties(FILLED))).toEqual(FILLED);
  });

  it("clears the editor for a draft without properties", () => {
    expect(propertiesToForm(null)).toEqual(emptyPublishPropertiesForm());
    expect(propertiesToForm(undefined)).toEqual(emptyPublishPropertiesForm());
  });
});

describe("propertiesSummaryLabel", () => {
  it("says nothing when nothing would be sent", () => {
    expect(propertiesSummaryLabel(emptyPublishPropertiesForm())).toBeNull();
    expect(
      propertiesSummaryLabel({
        ...emptyPublishPropertiesForm(),
        userProperties: [{ key: "", value: "" }],
      }),
    ).toBeNull();
  });

  it("counts each set field and each user property", () => {
    expect(propertiesSummaryLabel(FILLED)).toBe("7 properties");
    expect(
      propertiesSummaryLabel({
        ...emptyPublishPropertiesForm(),
        contentType: "text/plain",
      }),
    ).toBe("1 property");
  });
});

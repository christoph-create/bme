import { describe, expect, it } from "vitest";

import {
  AppSettings,
  DEFAULT_SETTINGS,
  MAX_MESSAGES_PER_TOPIC,
  MIN_MESSAGES_PER_TOPIC,
  SETTING_KEYS,
  clampMaxMessagesPerTopic,
  decodeSettings,
  encodeSetting,
  normalizeSetting,
} from "./app-settings";

describe("decodeSettings", () => {
  it("returns the defaults for an empty table", () => {
    expect(decodeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("reads every known key", () => {
    const decoded = decodeSettings({
      "ui.zoom": "1.25",
      "stream.timestamp_mode": "absolute",
      "stream.pretty_json": "false",
      "store.max_messages_per_topic": "42",
      "publish.default_format": "raw",
      "publish.default_qos": "AtLeastOnce",
      "publish.default_retain": "true",
      "subscribe.default_qos": "ExactlyOnce",
    });

    expect(decoded).toEqual<AppSettings>({
      uiZoom: 1.25,
      timestampMode: "absolute",
      prettyJson: false,
      maxMessagesPerTopic: 42,
      publishFormat: "raw",
      publishQos: "AtLeastOnce",
      publishRetain: true,
      subscribeQos: "ExactlyOnce",
    });
  });

  it("falls back per setting, not for the whole load, on a garbage value", () => {
    const decoded = decodeSettings({
      "stream.timestamp_mode": "sidereal",
      "stream.pretty_json": "yes",
      "publish.default_qos": "3",
      "publish.default_format": "raw",
    });

    expect(decoded.timestampMode).toBe(DEFAULT_SETTINGS.timestampMode);
    expect(decoded.prettyJson).toBe(DEFAULT_SETTINGS.prettyJson);
    expect(decoded.publishQos).toBe(DEFAULT_SETTINGS.publishQos);
    expect(decoded.publishFormat).toBe("raw");
  });

  it.each([
    ["abc", DEFAULT_SETTINGS.maxMessagesPerTopic],
    ["1.5", DEFAULT_SETTINGS.maxMessagesPerTopic],
    ["", DEFAULT_SETTINGS.maxMessagesPerTopic],
    ["-5", MIN_MESSAGES_PER_TOPIC],
    ["0", MIN_MESSAGES_PER_TOPIC],
    ["1000000000", MAX_MESSAGES_PER_TOPIC],
    [" 250 ", 250],
  ])("decodes max messages %j as %d", (raw, expected) => {
    expect(
      decodeSettings({ "store.max_messages_per_topic": raw })
        .maxMessagesPerTopic,
    ).toBe(expected);
  });

  it.each([
    ["1.5", 1.5],
    ["0.8", 0.8],
    ["2", 2],
    // Snapped to the nearest step, so the settings page always has a
    // matching option to show as selected.
    ["1.2", 1.25],
    ["0.3", 0.8],
    ["9", 2],
    ["huge", DEFAULT_SETTINGS.uiZoom],
    ["", DEFAULT_SETTINGS.uiZoom],
  ])("decodes a ui.zoom of %j as %d", (raw, expected) => {
    expect(decodeSettings({ "ui.zoom": raw }).uiZoom).toBe(expected);
  });

  it("ignores keys owned by other subsystems", () => {
    expect(
      decodeSettings({
        "update.skipped_version": "0.9.9",
        "update.last_checked_at": "2026-08-06T10:00:00Z",
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });
});

describe("encodeSetting / decodeSettings round trip", () => {
  const nonDefault: AppSettings = {
    uiZoom: 1.5,
    timestampMode: "absolute",
    prettyJson: false,
    maxMessagesPerTopic: 1234,
    publishFormat: "raw",
    publishQos: "ExactlyOnce",
    publishRetain: true,
    subscribeQos: "AtLeastOnce",
  };

  it.each(Object.keys(SETTING_KEYS) as (keyof AppSettings)[])(
    "round-trips %s",
    (key) => {
      const rows = { [SETTING_KEYS[key]]: encodeSetting(key, nonDefault[key]) };
      expect(decodeSettings(rows)[key]).toBe(nonDefault[key]);
    },
  );

  it("round-trips a zoom factor through its decimal string", () => {
    expect(encodeSetting("uiZoom", 1.25)).toBe("1.25");
    expect(normalizeSetting("uiZoom", 1.25)).toBe(1.25);
    // A value the shortcuts could never produce still lands on a step.
    expect(normalizeSetting("uiZoom", 1.37)).toBe(1.25);
  });

  it("stores every key under a distinct area.name string", () => {
    const keys = Object.values(SETTING_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});

describe("clampMaxMessagesPerTopic", () => {
  it("clamps into range and rejects non-integers", () => {
    expect(clampMaxMessagesPerTopic(5)).toBe(MIN_MESSAGES_PER_TOPIC);
    expect(clampMaxMessagesPerTopic(99_999)).toBe(MAX_MESSAGES_PER_TOPIC);
    expect(clampMaxMessagesPerTopic(300)).toBe(300);
    expect(clampMaxMessagesPerTopic(NaN)).toBe(
      DEFAULT_SETTINGS.maxMessagesPerTopic,
    );
    expect(clampMaxMessagesPerTopic(2.5)).toBe(
      DEFAULT_SETTINGS.maxMessagesPerTopic,
    );
  });
});

describe("normalizeSetting", () => {
  it("applies the same bounds a reload would", () => {
    expect(normalizeSetting("maxMessagesPerTopic", 3)).toBe(
      MIN_MESSAGES_PER_TOPIC,
    );
    expect(normalizeSetting("publishQos", "AtLeastOnce")).toBe("AtLeastOnce");
  });
});

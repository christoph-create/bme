import { MessageFormat } from "../models/message-format.model";
import { QoS } from "../models/qos";

/**
 * The app-level settings, as the UI sees them.
 *
 * The backend stores these as untyped `key`/`value` strings (see
 * `app_settings_repo.rs`) and never reads them, so this module *is* the
 * schema: which keys exist, what each value means, its default and its
 * bounds. Adding a setting is a change here plus a control on the settings
 * page - no Rust, no migration.
 */
export type TimestampMode = "relative" | "absolute";

export interface AppSettings {
  /** How the message stream labels a message's receive time by default. */
  timestampMode: TimestampMode;
  /** Whether the message stream pretty-prints JSON payloads by default. */
  prettyJson: boolean;
  /** Per connection/topic history cap in `MessageStoreService`. */
  maxMessagesPerTopic: number;
  publishFormat: MessageFormat;
  publishQos: QoS;
  publishRetain: boolean;
  subscribeQos: QoS;
}

export const MIN_MESSAGES_PER_TOPIC = 10;
export const MAX_MESSAGES_PER_TOPIC = 10_000;

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  timestampMode: "relative",
  prettyJson: true,
  maxMessagesPerTopic: 500,
  publishFormat: "json",
  publishQos: "AtMostOnce",
  publishRetain: false,
  subscribeQos: "AtMostOnce",
});

/** The `app_settings` row key for each setting, namespaced `area.name` per
 * the storage convention. These are a persisted contract: renaming one
 * silently resets that setting for every existing install. */
export const SETTING_KEYS: Readonly<Record<keyof AppSettings, string>> = {
  timestampMode: "stream.timestamp_mode",
  prettyJson: "stream.pretty_json",
  maxMessagesPerTopic: "store.max_messages_per_topic",
  publishFormat: "publish.default_format",
  publishQos: "publish.default_qos",
  publishRetain: "publish.default_retain",
  subscribeQos: "subscribe.default_qos",
};

const TIMESTAMP_MODES: readonly TimestampMode[] = ["relative", "absolute"];
const MESSAGE_FORMATS: readonly MessageFormat[] = ["json", "raw"];
const QOS_LEVELS: readonly QoS[] = ["AtMostOnce", "AtLeastOnce", "ExactlyOnce"];

function oneOf<T extends string>(
  allowed: readonly T[],
  raw: string | undefined,
  fallback: T,
): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

/** Clamps into the allowed range; anything that isn't a whole number falls
 * back to the default rather than to a bound, since garbage says nothing
 * about which end the user meant. */
export function clampMaxMessagesPerTopic(value: number): number {
  if (!Number.isInteger(value)) {
    return DEFAULT_SETTINGS.maxMessagesPerTopic;
  }
  return Math.min(
    MAX_MESSAGES_PER_TOPIC,
    Math.max(MIN_MESSAGES_PER_TOPIC, value),
  );
}

function integer(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^-?\d+$/.test(raw.trim())) {
    return fallback;
  }
  return Number(raw);
}

/**
 * Builds the settings from whatever the `app_settings` table holds. Tolerant
 * by design: a missing key, a value from a newer version, or a hand-edited
 * database all fall back to the default for that one setting rather than
 * failing the whole load. Keys this module doesn't know (`update.*`) are
 * ignored.
 */
export function decodeSettings(
  rows: Readonly<Record<string, string>>,
): AppSettings {
  const d = DEFAULT_SETTINGS;
  return {
    timestampMode: oneOf(
      TIMESTAMP_MODES,
      rows[SETTING_KEYS.timestampMode],
      d.timestampMode,
    ),
    prettyJson: bool(rows[SETTING_KEYS.prettyJson], d.prettyJson),
    maxMessagesPerTopic: clampMaxMessagesPerTopic(
      integer(rows[SETTING_KEYS.maxMessagesPerTopic], d.maxMessagesPerTopic),
    ),
    publishFormat: oneOf(
      MESSAGE_FORMATS,
      rows[SETTING_KEYS.publishFormat],
      d.publishFormat,
    ),
    publishQos: oneOf(QOS_LEVELS, rows[SETTING_KEYS.publishQos], d.publishQos),
    publishRetain: bool(rows[SETTING_KEYS.publishRetain], d.publishRetain),
    subscribeQos: oneOf(
      QOS_LEVELS,
      rows[SETTING_KEYS.subscribeQos],
      d.subscribeQos,
    ),
  };
}

/** The stored string for one setting's value - the inverse of
 * {@link decodeSettings} for that key. */
export function encodeSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): string {
  return String(value);
}

/** Normalises a value the way `decodeSettings` would after a round trip, so
 * what the UI holds never differs from what a restart would load. */
export function normalizeSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): AppSettings[K] {
  return decodeSettings({ [SETTING_KEYS[key]]: encodeSetting(key, value) })[
    key
  ];
}

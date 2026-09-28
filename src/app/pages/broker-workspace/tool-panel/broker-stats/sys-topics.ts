import {
  formatBytes,
  formatCount,
  formatDuration,
  formatPerMinute,
} from "./format-stat";

export type SysGroup =
  "Broker" | "Clients" | "Messages" | "Traffic" | "Load" | "Memory";

export type SysFormat = "count" | "bytes" | "duration" | "perMinute" | "text";

export interface SysMetric {
  readonly label: string;
  readonly group: SysGroup;
  readonly format: SysFormat;
}

/** The order groups appear in, coarsest first. Fixed rather than derived from
 * the catalogue, so reordering an entry can't quietly reorder the panel. */
export const SYS_GROUP_ORDER: readonly SysGroup[] = [
  "Broker",
  "Clients",
  "Messages",
  "Traffic",
  "Load",
  "Memory",
];

function metric(label: string, group: SysGroup, format: SysFormat): SysMetric {
  return { label, group, format };
}

/**
 * The `$SYS` topics this panel knows how to label and format.
 *
 * Mosquitto's tree, because it is the one that is actually standardised by
 * convention - `$SYS` itself never made it into the MQTT specification, so
 * EMQX, HiveMQ, VerneMQ and aedes each publish something different. Anything
 * not in here still shows up, in the raw table (`other-sys-topics.ts`); that
 * fallback is what stops a non-mosquitto broker looking broken.
 *
 * Insertion order is display order within a group.
 */
export const SYS_CATALOG: ReadonlyMap<string, SysMetric> = new Map([
  // Broker
  ["$SYS/broker/version", metric("Version", "Broker", "text")],
  ["$SYS/broker/uptime", metric("Broker uptime", "Broker", "duration")],

  // Clients
  ["$SYS/broker/clients/connected", metric("Connected", "Clients", "count")],
  ["$SYS/broker/clients/active", metric("Active", "Clients", "count")],
  ["$SYS/broker/clients/total", metric("Total", "Clients", "count")],
  ["$SYS/broker/clients/maximum", metric("Peak", "Clients", "count")],
  ["$SYS/broker/clients/inactive", metric("Inactive", "Clients", "count")],
  [
    "$SYS/broker/clients/disconnected",
    metric("Disconnected", "Clients", "count"),
  ],
  ["$SYS/broker/clients/expired", metric("Expired", "Clients", "count")],
  [
    "$SYS/broker/subscriptions/count",
    metric("Subscriptions", "Clients", "count"),
  ],
  [
    "$SYS/broker/shared_subscriptions/count",
    metric("Shared subs", "Clients", "count"),
  ],

  // Messages
  ["$SYS/broker/messages/received", metric("Received", "Messages", "count")],
  ["$SYS/broker/messages/sent", metric("Sent", "Messages", "count")],
  ["$SYS/broker/messages/stored", metric("Stored", "Messages", "count")],
  // Mosquitto spells this one with a literal space. Getting it wrong costs
  // nothing worse than the value landing in the raw table, but it is exactly
  // the sort of thing that is never noticed once it does.
  [
    "$SYS/broker/retained messages/count",
    metric("Retained", "Messages", "count"),
  ],
  [
    "$SYS/broker/publish/messages/received",
    metric("Publishes in", "Messages", "count"),
  ],
  [
    "$SYS/broker/publish/messages/sent",
    metric("Publishes out", "Messages", "count"),
  ],
  [
    "$SYS/broker/publish/messages/dropped",
    metric("Dropped", "Messages", "count"),
  ],

  // Traffic
  ["$SYS/broker/bytes/received", metric("Bytes in", "Traffic", "bytes")],
  ["$SYS/broker/bytes/sent", metric("Bytes out", "Traffic", "bytes")],
  [
    "$SYS/broker/publish/bytes/received",
    metric("Publish bytes in", "Traffic", "bytes"),
  ],
  [
    "$SYS/broker/publish/bytes/sent",
    metric("Publish bytes out", "Traffic", "bytes"),
  ],

  // Load - mosquitto's averages are per minute, not per second.
  [
    "$SYS/broker/load/messages/received/1min",
    metric("Messages in, 1 min", "Load", "perMinute"),
  ],
  [
    "$SYS/broker/load/messages/received/5min",
    metric("Messages in, 5 min", "Load", "perMinute"),
  ],
  [
    "$SYS/broker/load/messages/received/15min",
    metric("Messages in, 15 min", "Load", "perMinute"),
  ],
  [
    "$SYS/broker/load/messages/sent/1min",
    metric("Messages out, 1 min", "Load", "perMinute"),
  ],
  [
    "$SYS/broker/load/messages/sent/5min",
    metric("Messages out, 5 min", "Load", "perMinute"),
  ],
  [
    "$SYS/broker/load/messages/sent/15min",
    metric("Messages out, 15 min", "Load", "perMinute"),
  ],
  [
    "$SYS/broker/load/connections/1min",
    metric("Connections, 1 min", "Load", "perMinute"),
  ],
  [
    "$SYS/broker/load/publish/dropped/1min",
    metric("Dropped, 1 min", "Load", "perMinute"),
  ],

  // Memory. Mosquitto renamed these between versions; both spellings are
  // carried so an older broker doesn't fall through to the raw table.
  ["$SYS/broker/heap/current", metric("Heap now", "Memory", "bytes")],
  ["$SYS/broker/heap/maximum", metric("Heap peak", "Memory", "bytes")],
  ["$SYS/broker/heap/current size", metric("Heap now", "Memory", "bytes")],
  ["$SYS/broker/heap/maximum size", metric("Heap peak", "Memory", "bytes")],
]);

export function describeSysTopic(topic: string): SysMetric | null {
  return SYS_CATALOG.get(topic) ?? null;
}

/**
 * The leading number in a `$SYS` value, or null if there isn't one.
 *
 * Tolerant of a trailing unit word because mosquitto publishes uptime as
 * `"91240 seconds"` rather than a bare number - the one value in the tree
 * that isn't just a numeral.
 */
export function parseSysNumber(raw: string): number | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)/.exec(raw);
  return match === null ? null : Number(match[1]);
}

export interface SysReading {
  readonly topic: string;
  readonly label: string;
  readonly value: string;
}

export interface SysGroupReadings {
  readonly group: SysGroup;
  readonly readings: readonly SysReading[];
}

/** Formats one catalogued value. A number that won't parse falls back to the
 * raw text rather than to a dash: whatever the broker said is more use than
 * an admission that we didn't understand it. */
export function formatSysValue(raw: string, format: SysFormat): string {
  const text = raw.trim();
  if (format === "text") {
    return text;
  }
  const value = parseSysNumber(text);
  if (value === null) {
    return text;
  }
  switch (format) {
    case "count":
      return formatCount(value);
    case "bytes":
      return formatBytes(value);
    case "duration":
      return formatDuration(value * 1000);
    case "perMinute":
      return formatPerMinute(value);
  }
}

/**
 * The catalogued readings, grouped and formatted, in display order.
 *
 * `latest` maps a `$SYS` topic to its most recent decoded payload. Groups
 * with nothing in them are left out, so a broker that publishes half the tree
 * shows half the panel rather than a column of dashes.
 */
export function groupSysReadings(
  latest: ReadonlyMap<string, string>,
): readonly SysGroupReadings[] {
  const byGroup = new Map<SysGroup, SysReading[]>();

  for (const [topic, entry] of SYS_CATALOG) {
    const raw = latest.get(topic);
    if (raw === undefined) {
      continue;
    }
    const readings = byGroup.get(entry.group) ?? [];
    // Mosquitto's two heap spellings share a label, and a broker in the middle
    // of an upgrade could publish both - showing "Heap now" twice would read
    // as a bug.
    if (readings.some((reading) => reading.label === entry.label)) {
      continue;
    }
    readings.push({
      topic,
      label: entry.label,
      value: formatSysValue(raw, entry.format),
    });
    byGroup.set(entry.group, readings);
  }

  return SYS_GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
    group,
    readings: byGroup.get(group) ?? [],
  }));
}

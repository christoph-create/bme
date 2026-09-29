export type SysGroup =
  "Broker" | "Clients" | "Messages" | "Traffic" | "Load" | "Memory" | "Other";

export type SysFormat =
  "count" | "bytes" | "duration" | "perMinute" | "decimal" | "text";

/** The order groups appear in, coarsest first. Fixed rather than derived, so
 * adding a keyword can't quietly reorder the panel. */
export const SYS_GROUP_ORDER: readonly SysGroup[] = [
  "Broker",
  "Clients",
  "Messages",
  "Traffic",
  "Load",
  "Memory",
  "Other",
];

/**
 * Which group a reading belongs to, by the words in its normalised path.
 *
 * Keywords rather than whole paths, because `$SYS` was never standardised and
 * the vocabulary is the only thing brokers share: mosquitto counts
 * `clients/connected` where EMQX counts `connections`, but both say
 * *connection*. Measured against real captures this places 55/55 mosquitto
 * and 134/141 EMQX topics with no per-broker knowledge at all.
 *
 * Order matters - first match wins, and the earlier entries are the more
 * specific ones. `load` has to beat `message`, or every load average would be
 * filed as a message count.
 */
const GROUP_KEYWORDS: readonly (readonly [SysGroup, readonly string[]])[] = [
  [
    "Broker",
    ["version", "uptime", "sysdescr", "datetime", "description", "broker"],
  ],
  ["Load", ["load", "1min", "5min", "15min", "rate"]],
  ["Memory", ["heap", "memory", "cpu", "swap"]],
  ["Traffic", ["byte", "packet", "traffic"]],
  [
    "Clients",
    [
      "client",
      "connection",
      "session",
      "subscriber",
      "subscription",
      "suboption",
      "channel",
      "auth",
      "route",
    ],
  ],
  [
    "Messages",
    [
      "message",
      "publish",
      "deliver",
      "retained",
      "queue",
      "dropped",
      "acked",
      "forward",
      "persist",
      "topic",
    ],
  ],
];

export function groupOf(path: string): SysGroup {
  for (const [group, keywords] of GROUP_KEYWORDS) {
    if (keywords.some((keyword) => path.includes(keyword))) {
      return group;
    }
  }
  return "Other";
}

const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?\d*\.\d+$/;

/**
 * How to render a reading, from its path and the shape of its value.
 *
 * The path decides where it can; the value decides the rest. A broker that
 * reports uptime as `"34 seconds"` and one that reports `"1291616"` both come
 * out as a duration, because the word in the topic is what settles it.
 */
export function formatOf(path: string, value: string): SysFormat {
  if (path.includes("uptime")) {
    return "duration";
  }
  if (
    path.includes("byte") ||
    path.includes("heap") ||
    path.includes("memory")
  ) {
    return "bytes";
  }
  if (path.includes("load") || /\b(1|5|15)min\b/.test(path)) {
    return "perMinute";
  }
  const trimmed = value.trim();
  if (INTEGER.test(trimmed)) {
    return "count";
  }
  if (DECIMAL.test(trimmed)) {
    return "decimal";
  }
  return "text";
}

/** Words that are structure rather than meaning once a path is being read
 * out loud - the group already says "Load", so the label needn't repeat it. */
const REDUNDANT_LABEL_WORDS: ReadonlySet<string> = new Set(["load"]);

/**
 * A readable name for a reading nobody has curated.
 *
 * Deliberately mechanical: `clients/connected` becomes "Clients connected"
 * rather than anything cleverer, because a wrong-but-fluent label is worse
 * than an honest one. Curated readings get their name from `sys-concepts.ts`
 * instead; this is what everything else falls back to, and the full topic is
 * always one hover away.
 */
export function labelOf(path: string): string {
  const words = path
    .split("/")
    .flatMap((segment) => segment.split(/[_-]/))
    .filter((word) => word !== "" && !REDUNDANT_LABEL_WORDS.has(word))
    // `1min` reads as a unit, not a word.
    .map((word) => word.replace(/^(\d+)min$/, "$1 min"));

  if (words.length === 0) {
    return path;
  }
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

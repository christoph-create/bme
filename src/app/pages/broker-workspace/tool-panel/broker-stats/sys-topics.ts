import {
  formatBytes,
  formatCount,
  formatDuration,
  formatPerMinute,
} from "./format-stat";
import {
  SYS_GROUP_ORDER,
  SysFormat,
  SysGroup,
  formatOf,
  groupOf,
  labelOf,
} from "./sys-classify";
import { SYS_CONCEPTS, matchConcepts } from "./sys-concepts";
import { normaliseSysTopic } from "./sys-normalise";

export interface SysReading {
  /** The topic as the broker published it, for the tooltip and for anyone
   * wanting to find it in the tree. */
  readonly topic: string;
  readonly label: string;
  readonly value: string;
  readonly group: SysGroup;
  /** Set only on a curated reading, and only so the view knows which ones to
   * sparkline. */
  readonly conceptId?: string;
}

export interface SysGroupReadings {
  readonly group: SysGroup;
  readonly readings: readonly SysReading[];
}

export interface SysDashboard {
  /** The curated readings, as tiles, in concept order. */
  readonly headline: readonly SysReading[];
  /** Everything else, grouped and classified generically. No overlap with
   * `headline` - a reading appears once. */
  readonly details: readonly SysGroupReadings[];
}

/**
 * The leading number in a `$SYS` value, or null if there isn't one.
 *
 * Tolerant of a trailing unit word: mosquitto publishes uptime as
 * `"91240 seconds"` where EMQX publishes `"1291616"`, and both have to read
 * as the same kind of thing.
 */
export function parseSysNumber(raw: string): number | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)/.exec(raw);
  return match === null ? null : Number(match[1]);
}

/** Formats one value. A number that won't parse falls back to the raw text
 * rather than to a dash: whatever the broker said is more use than an
 * admission that we didn't understand it. */
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
    case "decimal":
      return String(value);
  }
}

/**
 * Turns whatever a broker published under `$SYS` into a dashboard.
 *
 * Three layers, and only the last one knows any broker by name:
 *
 * 1. `sys-normalise.ts` strips the scaffolding, so mosquitto's
 *    `$SYS/broker/subscriptions/count` and EMQX's
 *    `$SYS/brokers/<node>/stats/subscriptions/count` become one key.
 * 2. `sys-classify.ts` gives every reading a group, a label and a unit from
 *    the words in that key and the shape of its value. This is what makes a
 *    broker nobody has ever seen render as something readable.
 * 3. `sys-concepts.ts` promotes about fifteen of them to tiles and gives them
 *    better names.
 *
 * `latest` maps a `$SYS` topic to its most recent decoded payload.
 */
export function readSysDashboard(
  latest: ReadonlyMap<string, string>,
): SysDashboard {
  // Two brokers can normalise to one key - EMQX publishes both
  // `stats/subscriptions/count` and `stats/subscribers/count`, and a cluster
  // publishes one topic per node. Last one in wins, which for a per-node
  // duplicate is as good as any.
  const byPath = new Map<string, { topic: string; value: string }>();
  for (const [topic, value] of latest) {
    byPath.set(normaliseSysTopic(topic), { topic, value });
  }

  const matched = matchConcepts(new Set(byPath.keys()));
  const spokenFor = new Set(matched.values());

  const headline: SysReading[] = [];
  for (const concept of SYS_CONCEPTS) {
    const path = matched.get(concept);
    if (path === undefined) {
      continue;
    }
    const entry = byPath.get(path);
    if (entry === undefined) {
      continue;
    }
    headline.push({
      topic: entry.topic,
      label: concept.label,
      value: formatSysValue(
        entry.value,
        concept.format ?? formatOf(path, entry.value),
      ),
      group: concept.group,
      conceptId: concept.id,
    });
  }

  const byGroup = new Map<SysGroup, SysReading[]>();
  for (const [path, entry] of byPath) {
    if (spokenFor.has(path)) {
      continue;
    }
    const group = groupOf(path);
    const readings = byGroup.get(group) ?? [];
    readings.push({
      topic: entry.topic,
      label: labelOf(path),
      value: formatSysValue(entry.value, formatOf(path, entry.value)),
      group,
    });
    byGroup.set(group, readings);
  }

  const details = SYS_GROUP_ORDER.filter((group) => byGroup.has(group)).map(
    (group) => ({
      group,
      readings: (byGroup.get(group) ?? []).sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
    }),
  );

  return { headline, details };
}

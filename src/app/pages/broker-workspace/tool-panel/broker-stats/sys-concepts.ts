import { SysFormat, SysGroup } from "./sys-classify";

/**
 * A reading worth a tile of its own, and the ways brokers spell it.
 *
 * This is the *only* place in the panel that knows anything broker-specific,
 * and it is organised by meaning rather than by broker: one concept, N
 * spellings. `sys-normalise.ts` has already stripped the scaffolding, so most
 * brokers agree without help - `bytes/received` and `messages/sent` needed no
 * entries beyond the first.
 *
 * Adding a broker is usually nothing at all: `sys-classify.ts` gives every
 * unknown reading a group, a label and a unit on its own. At worst it is a
 * few strings added to a concept below. It is never a new table.
 *
 * `spellings` are normalised paths, in preference order - the first one a
 * broker actually publishes wins, so a broker carrying both `subscriptions`
 * and `subscribers` shows one tile rather than two.
 */
export interface SysConcept {
  readonly id: string;
  readonly label: string;
  readonly group: SysGroup;
  /** Overrides what `formatOf` would infer. Only needed where the value's
   * own shape is misleading. */
  readonly format?: SysFormat;
  readonly spellings: readonly string[];
}

export const SYS_CONCEPTS: readonly SysConcept[] = [
  {
    id: "version",
    label: "Version",
    group: "Broker",
    spellings: ["version"],
  },
  {
    id: "description",
    label: "Edition",
    group: "Broker",
    spellings: ["sysdescr", "description"],
  },
  {
    id: "uptime",
    label: "Broker uptime",
    group: "Broker",
    spellings: ["uptime"],
  },
  {
    id: "clientsConnected",
    label: "Connected",
    group: "Clients",
    spellings: ["clients/connected", "live_connections", "connections"],
  },
  {
    id: "clientsTotal",
    label: "Total",
    group: "Clients",
    spellings: ["clients/total", "sessions", "cluster_sessions"],
  },
  {
    id: "clientsPeak",
    label: "Peak",
    group: "Clients",
    spellings: ["clients/maximum", "connections/max", "live_connections/max"],
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    group: "Clients",
    spellings: ["subscriptions", "subscribers"],
  },
  {
    id: "topics",
    label: "Topics",
    group: "Messages",
    spellings: ["topics", "routes"],
  },
  {
    id: "retained",
    label: "Retained",
    group: "Messages",
    spellings: ["retained messages", "retained"],
  },
  {
    id: "messagesIn",
    label: "Received",
    group: "Messages",
    spellings: ["messages/received"],
  },
  {
    id: "messagesOut",
    label: "Sent",
    group: "Messages",
    spellings: ["messages/sent"],
  },
  {
    id: "bytesIn",
    label: "Bytes in",
    group: "Traffic",
    spellings: ["bytes/received"],
  },
  {
    id: "bytesOut",
    label: "Bytes out",
    group: "Traffic",
    spellings: ["bytes/sent"],
  },
  {
    id: "loadIn1min",
    label: "Messages in, 1 min",
    group: "Load",
    spellings: ["load/messages/received/1min"],
  },
  {
    id: "heapNow",
    label: "Heap now",
    group: "Memory",
    spellings: ["heap/current", "heap/current size"],
  },
];

/** The readings whose shape over time says more than the number - kept here
 * rather than in the view so the choice sits with the concepts it names. */
export const SPARKLINE_CONCEPTS: ReadonlySet<string> = new Set([
  "clientsConnected",
  "loadIn1min",
]);

/**
 * Picks each concept's reading out of what a broker actually published.
 *
 * Returns the normalised path chosen per concept, so the caller can both read
 * its value and know which paths are now spoken for.
 */
export function matchConcepts(
  paths: ReadonlySet<string>,
): ReadonlyMap<SysConcept, string> {
  const matched = new Map<SysConcept, string>();
  const taken = new Set<string>();

  for (const concept of SYS_CONCEPTS) {
    const spelling = concept.spellings.find(
      (candidate) => paths.has(candidate) && !taken.has(candidate),
    );
    if (spelling !== undefined) {
      matched.set(concept, spelling);
      taken.add(spelling);
    }
  }
  return matched;
}

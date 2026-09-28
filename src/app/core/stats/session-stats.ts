import { isSystemTopic } from "../mqtt/system-topics";
import { MqttEvent } from "../models/mqtt-event.model";
import { QoS } from "../models/qos";
import { RateWindow, createRateWindow, recordInWindow } from "./rate-window";

/**
 * How much one connection has moved since the user pressed Connect.
 *
 * The pure half of `SessionStatsService`, split the same way `reduceStatus`
 * is split out of `ConnectionStatusService`: the service holds a signal and
 * one subscription, everything worth a test lives here.
 */
export interface SessionStats {
  /** When this session began - the moment Connect was pressed, not the moment
   * the broker answered. Survives auto-reconnects, which is what makes it the
   * right clock for an uptime readout sitting next to a reconnect count. */
  readonly startedAt: number;
  /** When the current link came up, or null while there isn't one. */
  readonly connectedAt: number | null;
  readonly lastMessageAt: number | null;
  readonly reconnects: number;
  readonly messagesIn: number;
  /** Summed from `payload_len`, the true wire length, never from
   * `payload.length` - the backend truncates that at 256 KiB for IPC. It is
   * still only the payload: topic, headers and properties are not in here,
   * so it reads low against a packet capture. */
  readonly payloadBytesIn: number;
  readonly byQos: Readonly<Record<QoS, number>>;
  readonly retainedIn: number;
  readonly messagesOut: number;
  readonly payloadBytesOut: number;
  readonly perTopic: ReadonlyMap<string, number>;
  /** Inbound only. It feeds a "messages in per second" readout, so folding
   * what we publish into it would make the two tiles disagree. */
  readonly rate: RateWindow;
}

/** A broker that publishes a topic per device id can invent them faster than
 * anyone can read them, and this map only exists to rank a top five. Past the
 * cap, known topics keep counting and new ones stop being tracked. */
export const MAX_TRACKED_TOPICS = 1000;

const NO_QOS: Readonly<Record<QoS, number>> = Object.freeze({
  AtMostOnce: 0,
  AtLeastOnce: 0,
  ExactlyOnce: 0,
});

export function emptySessionStats(nowMs: number): SessionStats {
  return {
    startedAt: nowMs,
    connectedAt: null,
    lastMessageAt: null,
    reconnects: 0,
    messagesIn: 0,
    payloadBytesIn: 0,
    byQos: NO_QOS,
    retainedIn: 0,
    messagesOut: 0,
    payloadBytesOut: 0,
    perTopic: new Map(),
    rate: createRateWindow(nowMs),
  };
}

/**
 * Folds one backend event into a connection's counters.
 *
 * The event's `connection_id` is not checked here - as with `reduceStatus`,
 * the caller has already decided which connection this belongs to.
 *
 * Returns `stats` itself when nothing changed, so a signal holding it doesn't
 * wake every reader on an event that said nothing about throughput.
 */
export function reduceSessionStats(
  stats: SessionStats,
  event: MqttEvent,
  nowMs: number,
): SessionStats {
  if ("MessageReceived" in event) {
    const message = event.MessageReceived;
    // `$SYS` is the dashboard's own traffic: mosquitto publishes some forty
    // topics every ten seconds, so counting them would mean switching the
    // broker panel on visibly changed the numbers on the same screen, and
    // "busiest topics" became a list of the app watching itself.
    if (isSystemTopic(message.topic)) {
      return stats;
    }
    return {
      ...stats,
      lastMessageAt: nowMs,
      messagesIn: stats.messagesIn + 1,
      payloadBytesIn: stats.payloadBytesIn + message.payload_len,
      byQos: {
        ...stats.byQos,
        [message.qos]: stats.byQos[message.qos] + 1,
      },
      retainedIn: stats.retainedIn + (message.retain ? 1 : 0),
      perTopic: countTopic(stats.perTopic, message.topic),
      rate: recordInWindow(stats.rate, nowMs, message.payload_len),
    };
  }

  if ("Connected" in event) {
    return { ...stats, connectedAt: nowMs };
  }

  if ("Reconnecting" in event) {
    // Only the first attempt, because the backend emits one of these per
    // retry: counting them all would report a single outage as five.
    if (event.Reconnecting.attempt !== 1) {
      return stats;
    }
    return { ...stats, connectedAt: null, reconnects: stats.reconnects + 1 };
  }

  if ("Disconnected" in event) {
    return stats.connectedAt === null ? stats : { ...stats, connectedAt: null };
  }

  // A warning means the session survived something, which says nothing about
  // how much has moved through it.
  return stats;
}

/** Counts something the app sent. Separate from the event fold because
 * nothing comes back over the event stream to say a publish happened. */
export function recordPublished(
  stats: SessionStats,
  bytes: number,
): SessionStats {
  return {
    ...stats,
    messagesOut: stats.messagesOut + 1,
    payloadBytesOut: stats.payloadBytesOut + bytes,
  };
}

function countTopic(
  perTopic: ReadonlyMap<string, number>,
  topic: string,
): ReadonlyMap<string, number> {
  const seen = perTopic.get(topic);
  if (seen === undefined && perTopic.size >= MAX_TRACKED_TOPICS) {
    return perTopic;
  }
  return new Map(perTopic).set(topic, (seen ?? 0) + 1);
}

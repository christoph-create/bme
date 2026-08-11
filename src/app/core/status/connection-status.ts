import { MqttEvent } from "../models/mqtt-event.model";

/**
 * What the app believes a broker connection is currently doing.
 *
 * `reconnecting` counts as *not* connected: there is no session to publish
 * over, and the backend drops anything sent during the backoff.
 */
export type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "reconnecting"; attempt: number; maxAttempts: number }
  | { kind: "disconnected"; error: string | null };

/** Four tones, so a dot or a pill only ever has to pick one of four colours.
 * `idle` covers both "never connected" and "you disconnected on purpose":
 * from outside they are the same thing, and neither is a fault. */
export type StatusTone = "connected" | "pending" | "error" | "idle";

export const DISCONNECTED_BY_BROKER = "Disconnected from broker";

/**
 * Folds one backend event into a connection's status.
 *
 * The event's `connection_id` is *not* checked here - the caller has already
 * decided which connection this status belongs to.
 *
 * The `connect` command resolving only confirms the broker accepted the
 * request, not that a session exists, and the broker can drop an established
 * session later. These events are the only source of truth for that, which is
 * why status follows them rather than the connect() call.
 */
export function reduceStatus(
  current: ConnectionStatus,
  event: MqttEvent,
): ConnectionStatus {
  if ("Connected" in event) {
    return { kind: "connected" };
  }
  if ("Reconnecting" in event) {
    return {
      kind: "reconnecting",
      attempt: event.Reconnecting.attempt,
      maxAttempts: event.Reconnecting.max_attempts,
    };
  }
  if ("Disconnected" in event) {
    // Also the "gave up retrying" path - the backend only sends this once the
    // attempt budget is spent, so falling back to the plain error state with
    // its Retry button is exactly right.
    return { kind: "disconnected", error: DISCONNECTED_BY_BROKER };
  }
  // MessageReceived says nothing about the connection that a Connected event
  // has not already said.
  return current;
}

/** Which connection an event is about. Every variant carries it - the backend
 * broadcasts one stream for every broker at once. */
export function connectionIdOf(event: MqttEvent): string {
  if ("Connected" in event) return event.Connected.connection_id;
  if ("Disconnected" in event) return event.Disconnected.connection_id;
  if ("Reconnecting" in event) return event.Reconnecting.connection_id;
  return event.MessageReceived.connection_id;
}

export function statusTone(status: ConnectionStatus): StatusTone {
  switch (status.kind) {
    case "connected":
      return "connected";
    case "connecting":
    case "reconnecting":
      return "pending";
    case "disconnected":
      return status.error === null ? "idle" : "error";
  }
}

export function isConnected(status: ConnectionStatus): boolean {
  return status.kind === "connected";
}

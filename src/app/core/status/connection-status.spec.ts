import { describe, expect, it } from "vitest";

import { MqttEvent } from "../models/mqtt-event.model";
import {
  ConnectionStatus,
  DISCONNECTED_BY_BROKER,
  isConnected,
  connectionIdOf,
  reduceStatus,
  statusTone,
} from "./connection-status";

const ID = "11111111-1111-1111-1111-111111111111";

const CONNECTED: MqttEvent = { Connected: { connection_id: ID } };
const DISCONNECTED: MqttEvent = { Disconnected: { connection_id: ID } };

function reconnecting(attempt: number, maxAttempts = 10): MqttEvent {
  return {
    Reconnecting: {
      connection_id: ID,
      attempt,
      max_attempts: maxAttempts,
      delay_ms: 1000,
    },
  };
}

const CONNECTING: ConnectionStatus = { kind: "connecting" };

describe("reduceStatus", () => {
  it("settles on connected when the broker confirms the session", () => {
    expect(reduceStatus(CONNECTING, CONNECTED)).toEqual({ kind: "connected" });
  });

  it("reports a disconnect with the reason the banner shows", () => {
    expect(reduceStatus(CONNECTING, DISCONNECTED)).toEqual({
      kind: "disconnected",
      error: DISCONNECTED_BY_BROKER,
    });
  });

  it("flips back to an error if the broker drops an established session", () => {
    const connected = reduceStatus(CONNECTING, CONNECTED);

    expect(reduceStatus(connected, DISCONNECTED).kind).toBe("disconnected");
  });

  it("carries the attempt count while the backend is retrying", () => {
    expect(reduceStatus(CONNECTING, reconnecting(3))).toEqual({
      kind: "reconnecting",
      attempt: 3,
      maxAttempts: 10,
    });
  });

  it("clears the reconnect state when the session comes back", () => {
    const retrying = reduceStatus(CONNECTING, reconnecting(2));

    expect(reduceStatus(retrying, CONNECTED)).toEqual({ kind: "connected" });
  });

  it("falls back to the error state when the backend runs out of attempts", () => {
    const retrying = reduceStatus(CONNECTING, reconnecting(10));

    expect(reduceStatus(retrying, DISCONNECTED)).toEqual({
      kind: "disconnected",
      error: DISCONNECTED_BY_BROKER,
    });
  });

  it("leaves the status alone for a received message", () => {
    const connected = reduceStatus(CONNECTING, CONNECTED);

    const next = reduceStatus(connected, {
      MessageReceived: {
        connection_id: ID,
        topic: "a/b",
        payload: [1],
        payload_len: 1,
        qos: "AtMostOnce",
        retain: false,
      },
    });

    expect(next).toBe(connected);
  });
});

describe("isConnected", () => {
  it("counts only a live session as connected", () => {
    expect(isConnected({ kind: "connected" })).toBe(true);
    expect(isConnected(CONNECTING)).toBe(false);
    expect(isConnected({ kind: "disconnected", error: null })).toBe(false);
    // Publishing must stay disabled while retrying: there is no session, and
    // the backend drops anything sent during the backoff.
    expect(
      isConnected({ kind: "reconnecting", attempt: 1, maxAttempts: 10 }),
    ).toBe(false);
  });
});

describe("statusTone", () => {
  it("reads both unsettled states as one pending tone", () => {
    expect(statusTone(CONNECTING)).toBe("pending");
    expect(
      statusTone({ kind: "reconnecting", attempt: 1, maxAttempts: 10 }),
    ).toBe("pending");
  });

  it("separates a live session from a dead one", () => {
    expect(statusTone({ kind: "connected" })).toBe("connected");
    expect(statusTone({ kind: "disconnected", error: "boom" })).toBe("error");
  });

  /** A broker you have never opened, and one you disconnected from on purpose,
   * must not look like something went wrong. */
  it("reads a clean disconnect as idle rather than as a fault", () => {
    expect(statusTone({ kind: "disconnected", error: null })).toBe("idle");
  });
});

describe("warnings and disconnect reasons", () => {
  /** An oversize message drops the session but the connection re-establishes
   * itself, so the status has to be left exactly as it was. */
  it("leaves the status untouched for a warning", () => {
    const connected = reduceStatus(CONNECTING, CONNECTED);

    const next = reduceStatus(connected, {
      Warning: { connection_id: ID, message: "A 3.8 MB message was dropped" },
    });

    expect(next).toBe(connected);
  });

  it("shows the backend's reason instead of the generic disconnect text", () => {
    const next = reduceStatus(CONNECTING, {
      Disconnected: { connection_id: ID, reason: "A 50.0 MB message" },
    });

    expect(next).toEqual({ kind: "disconnected", error: "A 50.0 MB message" });
  });

  it("falls back to the generic text when there is no reason", () => {
    expect(reduceStatus(CONNECTING, DISCONNECTED)).toEqual({
      kind: "disconnected",
      error: DISCONNECTED_BY_BROKER,
    });
  });

  /** Without its own branch this would read the id off `MessageReceived` and
   * come back undefined, filing the warning under a connection that does not
   * exist. */
  it("knows which connection a warning is about", () => {
    expect(
      connectionIdOf({ Warning: { connection_id: ID, message: "…" } }),
    ).toBe(ID);
  });
});

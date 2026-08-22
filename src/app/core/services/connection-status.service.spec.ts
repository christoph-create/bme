import { TestBed } from "@angular/core/testing";
import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { MqttEvent } from "../models/mqtt-event.model";
import { DISCONNECTED_BY_BROKER } from "../status/connection-status";
import { ConnectionStatusService } from "./connection-status.service";
import { ConnectionsService } from "./connections.service";
import { MqttEventsService } from "./mqtt-events.service";

const ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";

function setup(
  options: {
    connect?: ReturnType<typeof vi.fn>;
    disconnect?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const connect = options.connect ?? vi.fn().mockResolvedValue(undefined);
  const disconnect = options.disconnect ?? vi.fn().mockResolvedValue(undefined);
  const events$ = new Subject<MqttEvent>();

  TestBed.configureTestingModule({
    providers: [
      { provide: ConnectionsService, useValue: { connect, disconnect } },
      { provide: MqttEventsService, useValue: { events$ } },
    ],
  });

  return {
    service: TestBed.inject(ConnectionStatusService),
    connect,
    disconnect,
    events$,
  };
}

describe("ConnectionStatusService", () => {
  it("reports a broker it has never seen as not connected, without an error", () => {
    const { service } = setup();

    expect(service.statusOf(ID)).toEqual({ kind: "disconnected", error: null });
  });

  it("goes connecting on connect and stays there until the broker confirms", async () => {
    const { service, connect, events$ } = setup();

    await service.connect(ID);

    expect(connect).toHaveBeenCalledWith(ID);
    expect(service.statusOf(ID)).toEqual({ kind: "connecting" });

    events$.next({ Connected: { connection_id: ID } });

    expect(service.statusOf(ID)).toEqual({ kind: "connected" });
  });

  it("records a rejected connect command as the error", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("broker unreachable"));
    const { service } = setup({ connect });

    await service.connect(ID);

    expect(service.statusOf(ID)).toEqual({
      kind: "disconnected",
      error: "broker unreachable",
    });
  });

  it("keeps each connection's status apart", () => {
    const { service, events$ } = setup();

    events$.next({ Connected: { connection_id: ID } });

    expect(service.statusOf(ID).kind).toBe("connected");
    expect(service.statusOf(OTHER_ID).kind).toBe("disconnected");
  });

  it("tracks a broker the app is not looking at", () => {
    const { service, events$ } = setup();

    events$.next({ Connected: { connection_id: OTHER_ID } });

    expect(service.statusOf(OTHER_ID).kind).toBe("connected");
  });

  it("exposes a connection's status as a signal", () => {
    const { service, events$ } = setup();
    const status = service.statusFor(ID);

    events$.next({ Connected: { connection_id: ID } });

    expect(status().kind).toBe("connected");
  });

  it("reports a clean disconnect without an error to show", async () => {
    const { service, disconnect } = setup();
    await service.connect(ID);

    await service.disconnect(ID);

    expect(disconnect).toHaveBeenCalledWith(ID);
    expect(service.statusOf(ID)).toEqual({ kind: "disconnected", error: null });
  });

  it("surfaces a failed disconnect and rethrows so the caller stays put", async () => {
    const disconnect = vi.fn().mockRejectedValue(new Error("still busy"));
    const { service } = setup({ disconnect });

    await expect(service.disconnect(ID)).rejects.toThrow("still busy");
    expect(service.statusOf(ID)).toEqual({
      kind: "disconnected",
      error: "still busy",
    });
  });

  it("stops a retry loop and leaves the error banner up", async () => {
    const { service, disconnect, events$ } = setup();
    events$.next({
      Reconnecting: {
        connection_id: ID,
        attempt: 2,
        max_attempts: 10,
        delay_ms: 2000,
      },
    });

    await service.stopReconnecting(ID);

    expect(disconnect).toHaveBeenCalledWith(ID);
    expect(service.statusOf(ID)).toEqual({
      kind: "disconnected",
      error: DISCONNECTED_BY_BROKER,
    });
  });

  it("surfaces a failure to stop retrying rather than leaving the spinner up", async () => {
    const disconnect = vi.fn().mockRejectedValue(new Error("stop failed"));
    const { service } = setup({ disconnect });

    await service.stopReconnecting(ID);

    expect(service.statusOf(ID)).toEqual({
      kind: "disconnected",
      error: "stop failed",
    });
  });

  /** Every received message passes through the reducer; rebuilding the status
   * map for each one would wake every reader in the app on every message. */
  it("does not churn its state on received messages", () => {
    const { service, events$ } = setup();
    events$.next({ Connected: { connection_id: ID } });
    const before = service.statusOf(ID);

    events$.next({
      MessageReceived: {
        connection_id: ID,
        topic: "a/b",
        payload: [1],
        payload_len: 1,
        qos: "AtMostOnce",
        retain: false,
      },
    });

    expect(service.statusOf(ID)).toBe(before);
  });

  it("forgets a connection that has been deleted", async () => {
    const { service } = setup();
    await service.connect(ID);

    service.forget(ID);

    expect(service.statusOf(ID)).toEqual({ kind: "disconnected", error: null });
  });

  describe("warnings", () => {
    const WARNING = "A 3.8 MB message was dropped";

    it("records a warning without disturbing the status", () => {
      const { service, events$ } = setup();
      events$.next({ Connected: { connection_id: ID } });
      const before = service.statusOf(ID);

      events$.next({ Warning: { connection_id: ID, message: WARNING } });

      expect(service.warningOf(ID)).toBe(WARNING);
      expect(service.statusOf(ID)).toBe(before);
    });

    it("keeps warnings apart per connection", () => {
      const { service, events$ } = setup();

      events$.next({ Warning: { connection_id: ID, message: WARNING } });

      expect(service.warningOf(OTHER_ID)).toBeNull();
    });

    /** The oversize case re-establishes the session moments after warning, so
     * clearing on Connected would wipe the message before it could be read -
     * only an explicit action clears it. */
    it("survives the reconnect that follows it", () => {
      const { service, events$ } = setup();

      events$.next({ Warning: { connection_id: ID, message: WARNING } });
      events$.next({ Connected: { connection_id: ID } });

      expect(service.warningOf(ID)).toBe(WARNING);
    });

    it("is cleared by dismissing it", () => {
      const { service, events$ } = setup();
      events$.next({ Warning: { connection_id: ID, message: WARNING } });

      service.dismissWarning(ID);

      expect(service.warningOf(ID)).toBeNull();
    });

    it("is cleared by connecting again, which starts a fresh story", async () => {
      const { service, events$ } = setup();
      events$.next({ Warning: { connection_id: ID, message: WARNING } });

      await service.connect(ID);

      expect(service.warningOf(ID)).toBeNull();
    });

    it("is dropped along with a forgotten connection", () => {
      const { service, events$ } = setup();
      events$.next({ Warning: { connection_id: ID, message: WARNING } });

      service.forget(ID);

      expect(service.warningOf(ID)).toBeNull();
    });
  });
});
